import AppKit
import EventKit
import Foundation

@MainActor
final class AgendaStore {
    private let store = EKEventStore()
    private var ready = false

    func ensureAccess() async throws {
        if ready { return }
        NSApplication.shared.setActivationPolicy(.accessory)
        NSApplication.shared.activate(ignoringOtherApps: true)
        try await request(.reminder)
        try await request(.event)
        ready = true
    }

    func authorize(_ input: [String: Any]) async throws -> [String: Any] {
        _ = input
        NSApplication.shared.setActivationPolicy(.accessory)
        NSApplication.shared.activate(ignoringOtherApps: true)
        let reminders = try await authorizeEntity(.reminder)
        let events = try await authorizeEntity(.event)
        let granted = isReadable(reminders) && isReadable(events)
        ready = granted
        let pane = settingsPane(reminders: reminders, events: events)
        if let pane { openPrivacySettings(pane) }
        return [
            "access": ["reminders": reminders, "events": events],
            "granted": granted,
            "openedSettings": pane != nil,
        ]
    }

    func snapshot(_ input: [String: Any]) async throws -> [String: Any] {
        try await ensureAccess()
        let limit = min(max(JSON.int(input, "limit") ?? 200, 1), 500)
        let includeCompleted = JSON.bool(input, "includeCompleted") ?? false
        let listFilter = JSON.string(input, "reminderList")
        let calendarFilter = JSON.string(input, "calendar")
        let from = JSON.string(input, "from").flatMap(Dates.parse) ?? Dates.startOfToday()
        let to = JSON.string(input, "to").flatMap(Dates.parse) ?? Calendar.current.date(byAdding: .day, value: 7, to: from) ?? from

        let reminderCalendars = matching(store.calendars(for: .reminder), filter: listFilter)
        let eventCalendars = matching(store.calendars(for: .event), filter: calendarFilter)
        let reminders = try await loadReminders(calendars: reminderCalendars, includeCompleted: includeCompleted, from: from, to: to, limit: limit)
        let events = loadEvents(calendars: eventCalendars, from: from, to: to, limit: limit)
        return [
            "access": accessReport(),
            "from": Dates.format(from) as Any,
            "to": Dates.format(to) as Any,
            "lists": store.calendars(for: .reminder).map(calendarJSON),
            "calendars": store.calendars(for: .event).map(calendarJSON),
            "reminders": reminders,
            "events": events,
        ]
    }

    func createReminder(_ input: [String: Any]) async throws -> [String: Any] {
        try await ensureAccess()
        guard let title = JSON.string(input, "title") else {
            throw AgendaError(code: "BAD_INPUT", message: "提醒事项需要标题")
        }
        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.calendar = try reminderCalendar(JSON.string(input, "list"))
        if let notes = JSON.string(input, "notes") { reminder.notes = notes }
        if let dueText = JSON.string(input, "due"), let due = Dates.parse(dueText) {
            reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
        }
        if let priority = JSON.string(input, "priority") ?? JSON.int(input, "priority").map(String.init) {
            reminder.priority = priorityValue(priority)
        }
        try store.save(reminder, commit: true)
        return ["reminder": reminderJSON(reminder)]
    }

    func completeReminder(_ input: [String: Any]) async throws -> [String: Any] {
        try await ensureAccess()
        let reminder = try reminder(JSON.string(input, "id"))
        reminder.isCompleted = JSON.bool(input, "completed") ?? true
        try store.save(reminder, commit: true)
        return ["reminder": reminderJSON(reminder)]
    }

    func deleteReminder(_ input: [String: Any]) async throws -> [String: Any] {
        try await ensureAccess()
        let reminder = try reminder(JSON.string(input, "id"))
        let id = reminder.calendarItemIdentifier
        try store.remove(reminder, commit: true)
        return ["id": id, "deleted": true]
    }

    func createEvent(_ input: [String: Any]) async throws -> [String: Any] {
        try await ensureAccess()
        guard let title = JSON.string(input, "title") else {
            throw AgendaError(code: "BAD_INPUT", message: "日程需要标题")
        }
        guard let startText = JSON.string(input, "start"), let start = Dates.parse(startText) else {
            throw AgendaError(code: "BAD_INPUT", message: "日程需要开始时间")
        }
        guard let endText = JSON.string(input, "end"), var end = Dates.parse(endText) else {
            throw AgendaError(code: "BAD_INPUT", message: "日程需要结束时间")
        }
        let event = EKEvent(eventStore: store)
        event.title = title
        event.calendar = try eventCalendar(JSON.string(input, "calendar"))
        if let notes = JSON.string(input, "notes") { event.notes = notes }
        if let location = JSON.string(input, "location") { event.location = location }
        let allDay = Dates.isDateOnly(startText) && Dates.isDateOnly(endText)
        if allDay {
            event.isAllDay = true
            if end <= start { end = Calendar.current.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86400) }
        }
        guard end > start else { throw AgendaError(code: "BAD_INPUT", message: "结束时间必须晚于开始时间") }
        event.startDate = start
        event.endDate = end
        try store.save(event, span: .thisEvent, commit: true)
        return ["event": eventJSON(event)]
    }

    func deleteEvent(_ input: [String: Any]) async throws -> [String: Any] {
        try await ensureAccess()
        let event = try event(JSON.string(input, "id"))
        let id = event.eventIdentifier ?? event.calendarItemIdentifier
        try store.remove(event, span: .thisEvent, commit: true)
        return ["id": id, "deleted": true]
    }

    private func request(_ entity: EKEntityType) async throws {
        let status = try await authorizeEntity(entity)
        if isReadable(status) { return }
        throw AgendaError(code: "ACCESS_DENIED", message: deniedMessage(entity, EKEventStore.authorizationStatus(for: entity)), access: accessReport())
    }

    private func authorizeEntity(_ entity: EKEntityType) async throws -> String {
        let current = EKEventStore.authorizationStatus(for: entity)
        if isReadable(statusName(current)) { return statusName(current) }
        if current == .denied || current == .restricted || current == .writeOnly { return statusName(current) }
        let granted = entity == .reminder
            ? try await store.requestFullAccessToReminders()
            : try await store.requestFullAccessToEvents()
        let next = EKEventStore.authorizationStatus(for: entity)
        if granted || isReadable(statusName(next)) { return statusName(next) }
        return statusName(next)
    }

    private func isReadable(_ status: String) -> Bool {
        status == "fullAccess" || status == "authorized"
    }

    private func settingsPane(reminders: String, events: String) -> String? {
        if !isReadable(reminders) && reminders != "notDetermined" { return "Privacy_Reminders" }
        if !isReadable(events) && events != "notDetermined" { return "Privacy_Calendars" }
        return nil
    }

    private func openPrivacySettings(_ pane: String) {
        let urls = [
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(pane)",
            "x-apple.systempreferences:com.apple.preference.security?\(pane)",
        ]
        for text in urls {
            guard let url = URL(string: text) else { continue }
            if NSWorkspace.shared.open(url) { return }
        }
    }

    private func loadReminders(calendars: [EKCalendar], includeCompleted: Bool, from: Date, to: Date, limit: Int) async throws -> [[String: Any]] {
        let incomplete = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
        var items = try await fetch(incomplete)
        if includeCompleted {
            let completed = store.predicateForCompletedReminders(withCompletionDateStarting: from, ending: to, calendars: calendars)
            items.append(contentsOf: try await fetch(completed))
        }
        return Array(items.sorted(by: reminderSort).prefix(limit).map(reminderJSON))
    }

    private func loadEvents(calendars: [EKCalendar], from: Date, to: Date, limit: Int) -> [[String: Any]] {
        guard to > from else { return [] }
        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars.isEmpty ? nil : calendars)
        return Array(store.events(matching: predicate).sorted { $0.startDate < $1.startDate }.prefix(limit).map(eventJSON))
    }

    private func fetch(_ predicate: NSPredicate) async throws -> [EKReminder] {
        try await withCheckedThrowingContinuation { continuation in
            store.fetchReminders(matching: predicate) { reminders in
                if let reminders {
                    continuation.resume(returning: reminders)
                } else {
                    continuation.resume(throwing: AgendaError(code: "FETCH_FAILED", message: "提醒事项读取失败"))
                }
            }
        }
    }

    private func reminder(_ id: String?) throws -> EKReminder {
        guard let id, let item = store.calendarItem(withIdentifier: id) as? EKReminder else {
            throw AgendaError(code: "NOT_FOUND", message: "找不到这条提醒事项")
        }
        return item
    }

    private func event(_ id: String?) throws -> EKEvent {
        guard let id else { throw AgendaError(code: "BAD_INPUT", message: "缺少日程 id") }
        if let item = store.calendarItem(withIdentifier: id) as? EKEvent { return item }
        if let item = store.event(withIdentifier: id) { return item }
        throw AgendaError(code: "NOT_FOUND", message: "找不到这条日程")
    }

    private func reminderCalendar(_ name: String?) throws -> EKCalendar {
        if let match = matching(store.calendars(for: .reminder), filter: name).first { return match }
        if let fallback = store.defaultCalendarForNewReminders() { return fallback }
        throw AgendaError(code: "NO_LIST", message: "没有可用的提醒事项列表")
    }

    private func eventCalendar(_ name: String?) throws -> EKCalendar {
        if let match = matching(store.calendars(for: .event), filter: name).first { return match }
        if let fallback = store.defaultCalendarForNewEvents { return fallback }
        throw AgendaError(code: "NO_CALENDAR", message: "没有可用的日历")
    }

    private func matching(_ calendars: [EKCalendar], filter: String?) -> [EKCalendar] {
        guard let filter else { return calendars }
        return calendars.filter { $0.title == filter || $0.calendarIdentifier == filter }
    }

    private func accessReport() -> [String: String] {
        [
            "reminders": statusName(.reminder),
            "events": statusName(.event),
        ]
    }

    private func statusName(_ entity: EKEntityType) -> String {
        statusName(EKEventStore.authorizationStatus(for: entity))
    }

    private func statusName(_ status: EKAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .fullAccess: return "fullAccess"
        case .writeOnly: return "writeOnly"
        case .authorized: return "authorized"
        @unknown default: return "unknown"
        }
    }

    private func deniedMessage(_ entity: EKEntityType, _ status: EKAuthorizationStatus) -> String {
        let name = entity == .reminder ? "提醒事项" : "日历"
        return "没有\(name)的完整访问权限（\(statusName(entity))）。请在「系统设置 → 隐私与安全性 → \(name)」中允许 IosAgenda.app（work.1agents.ios-agenda）。"
    }

    private func priorityValue(_ text: String) -> Int {
        switch text.lowercased() {
        case "high", "1": return 1
        case "medium", "5": return 5
        case "low", "9": return 9
        case "none", "0": return 0
        default: return Int(text) ?? 0
        }
    }

    private func reminderSort(_ lhs: EKReminder, _ rhs: EKReminder) -> Bool {
        let left = lhs.dueDateComponents?.date ?? .distantFuture
        let right = rhs.dueDateComponents?.date ?? .distantFuture
        if left != right { return left < right }
        return (lhs.title ?? "") < (rhs.title ?? "")
    }

    private func calendarJSON(_ calendar: EKCalendar) -> [String: Any] {
        [
            "id": calendar.calendarIdentifier,
            "title": calendar.title,
            "source": calendar.source.title,
            "color": colorHex(calendar.cgColor),
            "allowsWrites": calendar.allowsContentModifications,
        ]
    }

    private func colorHex(_ color: CGColor) -> String {
        let rgb = color.converted(to: CGColorSpaceCreateDeviceRGB(), intent: .defaultIntent, options: nil) ?? color
        guard let components = rgb.components, components.count >= 3 else { return "#8E8E93" }
        let channels = components.prefix(3).map { component -> Int in
            Int((min(max(component, 0), 1) * 255).rounded())
        }
        return String(format: "#%02X%02X%02X", channels[0], channels[1], channels[2])
    }

    private func reminderJSON(_ reminder: EKReminder) -> [String: Any] {
        var object: [String: Any] = [
            "id": reminder.calendarItemIdentifier,
            "title": reminder.title ?? "",
            "completed": reminder.isCompleted,
            "list": reminder.calendar.title,
            "listId": reminder.calendar.calendarIdentifier,
            "priority": reminder.priority,
        ]
        if let notes = reminder.notes { object["notes"] = notes }
        if let components = reminder.dueDateComponents, let due = components.date ?? Calendar.current.date(from: components) {
            object["due"] = Dates.format(due) as Any
        }
        if let completedAt = reminder.completionDate { object["completedAt"] = Dates.format(completedAt) as Any }
        return object
    }

    private func eventJSON(_ event: EKEvent) -> [String: Any] {
        var object: [String: Any] = [
            "id": event.eventIdentifier ?? event.calendarItemIdentifier,
            "title": event.title ?? "",
            "calendar": event.calendar.title,
            "calendarId": event.calendar.calendarIdentifier,
            "allDay": event.isAllDay,
            "start": Dates.format(event.startDate) as Any,
            "end": Dates.format(event.endDate) as Any,
        ]
        if let notes = event.notes { object["notes"] = notes }
        if let location = event.location { object["location"] = location }
        return object
    }
}
