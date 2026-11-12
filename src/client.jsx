/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { contribution, PANEL_ID, SERVICE } from './contract.js';

const NS = 'iosAgenda';
const zh = {
    panel: '日程',
    refresh: '刷新',
    loading: '正在读取本机数据…',
    unavailable: '页面还没有连上本机读写程序',
    newReminder: '新提醒',
    newEvent: '新日程',
    titleField: '标题',
    start: '开始',
    end: '结束',
    add: '添加',
    complete: '完成',
    remove: '删除',
    permission: '需要在系统设置里允许 IosAgenda.app（work.1agents.ios-agenda）访问提醒事项和日历。',
    allDay: '全天',
    continues: '续',
    overdue: '逾期',
    undated: '无日期',
    emptyDay: '这一天没有安排',
    today: '今天',
    week: '本周',
    prevMonth: '上个月',
    nextMonth: '下个月',
    untitled: '未命名',
    lists: '列表',
    calendars: '日历',
};
const en = {
    panel: 'Agenda',
    refresh: 'Refresh',
    loading: 'Reading local data…',
    unavailable: 'The local agenda program is not connected',
    newReminder: 'New reminder',
    newEvent: 'New event',
    titleField: 'Title',
    start: 'Start',
    end: 'End',
    add: 'Add',
    complete: 'Complete',
    remove: 'Delete',
    permission: 'Allow IosAgenda.app (work.1agents.ios-agenda) to access Reminders and Calendar in System Settings.',
    allDay: 'All day',
    continues: 'Continues',
    overdue: 'Overdue',
    undated: 'No date',
    emptyDay: 'Nothing scheduled',
    today: 'Today',
    week: 'This week',
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    untitled: 'Untitled',
    lists: 'Lists',
    calendars: 'Calendars',
};

const VIEW_PREFERENCE_KEY = 'dsh.ios-agenda.view';

function hexColor(value) {
    return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '';
}

function idList(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((item) => typeof item === 'string' && item);
}

function readViewPreference() {
    const empty = { mode: 'day', hiddenLists: [], hiddenCalendars: [] };
    if (typeof localStorage === 'undefined') return empty;
    try {
        const parsed = JSON.parse(localStorage.getItem(VIEW_PREFERENCE_KEY) || 'null');
        if (!parsed || typeof parsed !== 'object') return empty;
        return {
            mode: parsed.mode === 'week' ? 'week' : 'day',
            hiddenLists: idList(parsed.hiddenLists),
            hiddenCalendars: idList(parsed.hiddenCalendars),
        };
    } catch {
        return empty;
    }
}

function soleAccent(colors) {
    const unique = new Set(colors.filter(Boolean));
    return unique.size === 1 ? [...unique][0] : '';
}

function startOfDay(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function startOfWeek(date) {
    const day = startOfDay(date);
    const weekday = day.getDay();
    return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

function monthGrid(year, month) {
    const start = startOfWeek(new Date(year, month, 1));
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function sameDay(left, right) {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function dayKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function hasClock(date) {
    return date.getHours() !== 0 || date.getMinutes() !== 0;
}

function clock(date) {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function monthHeading(year, month) {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' }).format(new Date(year, month, 1));
}

function dayHeading(date) {
    return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

function shortDate(date) {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function weekdayNarrow(index) {
    const monday = new Date(2026, 0, 5);
    return new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(addDays(monday, index));
}

function weekdayShort(date) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
}

function localInputValue(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}T${hour}:${minute}`;
}

function eventOverlapsDay(event, day) {
    const start = parseDate(event.start);
    if (!start) return false;
    const end = parseDate(event.end);
    const dayStart = startOfDay(day);
    const dayEnd = addDays(dayStart, 1);
    const eventEnd = end && end > start ? end : new Date(start.getTime() + (event.allDay ? 86400000 : 0));
    return start < dayEnd && eventEnd > dayStart;
}

function reminderOnDay(item, day) {
    const due = parseDate(item.due);
    return Boolean(due && sameDay(due, day));
}

function isOverdue(item, today) {
    const due = parseDate(item.due);
    return Boolean(due && startOfDay(due) < startOfDay(today));
}

function eventTimeLabel(event, day, t) {
    if (event.allDay) return t('allDay');
    const start = parseDate(event.start);
    const end = parseDate(event.end);
    if (!start) return '';
    const startsToday = sameDay(start, day);
    const endsToday = Boolean(end && sameDay(end, day));
    if (startsToday && endsToday) return `${clock(start)}–${clock(end)}`;
    if (startsToday) return end ? `${clock(start)}–` : clock(start);
    if (endsToday) return `–${clock(end)}`;
    return t('continues');
}

function reminderTimeLabel(item) {
    const due = parseDate(item.due);
    if (!due || !hasClock(due)) return '';
    return clock(due);
}

function overdueTimeLabel(item) {
    const due = parseDate(item.due);
    if (!due) return '';
    return hasClock(due) ? `${shortDate(due)} ${clock(due)}` : shortDate(due);
}

function dayBlocks(day, events, reminders) {
    const timed = [];
    const later = [];
    events.filter((event) => eventOverlapsDay(event, day)).forEach((event) => {
        const block = { kind: 'event', id: event.id, event, day, at: parseDate(event.start)?.getTime() ?? 0 };
        (event.allDay ? later : timed).push(block);
    });
    reminders.filter((item) => reminderOnDay(item, day)).forEach((reminder) => {
        const due = parseDate(reminder.due);
        const block = { kind: 'reminder', id: reminder.id, reminder, day, at: due?.getTime() ?? 0 };
        (due && hasClock(due) ? timed : later).push(block);
    });
    timed.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id));
    return [...timed, ...later];
}

function visibleRange(year, month) {
    const days = monthGrid(year, month);
    const from = days[0];
    const to = addDays(days[days.length - 1], 1);
    return { from: from.toISOString(), to: to.toISOString(), key: `${dayKey(from)}/${dayKey(to)}`, days };
}

async function invoke(agenda, method, input) {
    if (!agenda?.[method]) return { ok: false, error: { code: 'UNAVAILABLE', message: 'remote missing' } };
    const result = await agenda[method](input, new AbortController().signal);
    if (!result?.ok) return { ok: false, error: result?.error ?? { code: 'FAILED', message: '调用失败' } };
    return result.value;
}

const ENTRY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"></rect><path d="M3 10h18M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>';
const ENTRY_STYLE = `
[data-dsh-ios-agenda-entry] {
  box-sizing: border-box; flex: none; min-height: 36px; margin: 0 2px 4px;
  color: var(--dsw-alias-label-primary); cursor: pointer; white-space: nowrap;
  background: transparent; border: none; border-radius: var(--dsw-radius-md);
  align-items: center; gap: 8px; padding: 7px 8px; font: inherit; line-height: 22px;
  text-align: left; display: flex;
}
[data-dsh-ios-agenda-entry]:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-dsh-ios-agenda-entry]:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
[data-dsh-ios-agenda-entry] .ia-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; }
[data-dsh-ios-agenda-entry] .ia-icon svg { width: 16px; height: 16px; }
[data-dsh-ios-agenda-entry] .ia-label { min-width: 0; text-overflow: ellipsis; overflow: hidden; }
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-ios-agenda-entry],
[data-sidebar-collapsed] [data-dsh-ios-agenda-entry] {
  justify-content: center; width: 36px; height: 36px; margin: 0 0 12px; padding: 0;
}
[data-sidebar-collapsed] [data-dsh-ios-agenda-entry] .ia-icon svg { width: 18px; height: 18px; }
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-ios-agenda-entry] .ia-label,
[data-sidebar-collapsed] [data-dsh-ios-agenda-entry] .ia-label { display: none; }
`;

function escapeText(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mountSidebarEntry({ label, onOpen }) {
    if (typeof document === 'undefined') return () => {};
    if (document.getElementById('ios-agenda-sidebar-style') === null) {
        const style = document.createElement('style');
        style.id = 'ios-agenda-sidebar-style';
        style.textContent = ENTRY_STYLE;
        (document.head ?? document.documentElement).appendChild(style);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-dsh-ios-agenda-entry', '');
    button.setAttribute('data-dsh-plugin', 'ios-agenda');
    button.setAttribute('data-dsh-part', 'sidebar-entry');
    button.addEventListener('click', onOpen);
    const paint = () => {
        const text = label();
        button.title = text;
        button.setAttribute('aria-label', text);
        if (button.dataset.label === text) return;
        button.dataset.label = text;
        button.innerHTML = `<span class="ia-icon">${ENTRY_ICON}</span><span class="ia-label">${escapeText(text)}</span>`;
    };
    const place = () => {
        const sidebar = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
        const column = sidebar?.querySelector('[class*="logoRow"]')?.parentElement ?? sidebar?.firstElementChild;
        if (!column) return;
        paint();
        const history = column.querySelector('[data-dsh-session-reader-entry]');
        if (history) {
            if (button.nextElementSibling !== history) column.insertBefore(button, history);
            return;
        }
        const newer = column.querySelector('button[class*="newSession"]');
        if (newer) {
            if (button.previousElementSibling !== newer) newer.insertAdjacentElement('afterend', button);
            return;
        }
        if (button.parentElement !== column) column.appendChild(button);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        button.remove();
    };
}

function AgendaRow({ compact, time, title, source, location, notes, overdue, accent, onComplete, onDelete, t, busy }) {
    const style = accent ? { '--ia-accent': accent } : undefined;
    if (compact) {
        return <article className={overdue ? 'ia-compact is-overdue' : 'ia-compact'} style={style}>
            <div className="ia-compact-top">
                {onComplete ? <input type="checkbox" checked={false} aria-label={t('complete')} disabled={busy} onChange={onComplete} /> : <span className="ia-time">{time}</span>}
                {onComplete ? <span className="ia-time">{time}</span> : null}
                {onDelete ? <button type="button" className="ia-delete" disabled={busy} onClick={onDelete}>{t('remove')}</button> : null}
            </div>
            <strong className="ia-title">{title || t('untitled')}</strong>
            {source ? <span className="ia-source">{source}</span> : null}
        </article>;
    }
    return <article className={overdue ? 'ia-row is-overdue' : 'ia-row'} style={style}>
        {onComplete
            ? <input type="checkbox" checked={false} aria-label={t('complete')} disabled={busy} onChange={onComplete} />
            : <span className="ia-check-spacer" />}
        <span className="ia-time">{time}</span>
        <span className="ia-main">
            <strong className="ia-title">{title || t('untitled')}</strong>
            {notes ? <span className="ia-detail">{notes}</span> : null}
        </span>
        {source ? <span className="ia-source">{source}</span> : null}
        {location ? <span className="ia-location">{location}</span> : null}
        {onDelete ? <button type="button" className="ia-delete" disabled={busy} onClick={onDelete}>{t('remove')}</button> : null}
    </article>;
}

function AgendaBlocks({ blocks, overdueIds, listColors, calendarColors, t, busy, onComplete, onDelete, compact }) {
    return blocks.map((block) => {
        if (block.kind === 'event') {
            const { event, day } = block;
            return <AgendaRow
                key={`event:${event.id}:${dayKey(day)}`}
                compact={compact}
                time={eventTimeLabel(event, day, t)}
                title={event.title}
                source={event.calendar}
                location={compact ? '' : event.location}
                notes={compact ? '' : event.notes}
                accent={calendarColors.get(event.calendarId) || ''}
                onDelete={() => onDelete('deleteEvent', event.id)}
                t={t}
                busy={busy}
            />;
        }
        const { reminder } = block;
        return <AgendaRow
            key={`reminder:${reminder.id}`}
            compact={compact}
            time={reminderTimeLabel(reminder)}
            title={reminder.title}
            source={reminder.list}
            notes={compact ? '' : reminder.notes}
            overdue={overdueIds.has(reminder.id)}
            accent={listColors.get(reminder.listId) || ''}
            onComplete={() => onComplete(reminder.id)}
            onDelete={() => onDelete('deleteReminder', reminder.id)}
            t={t}
            busy={busy}
        />;
    });
}

function FilterList({ label, items, hidden, onToggle }) {
    const rowsRef = useRef(null);
    const positions = useRef(new Map());
    const ordered = useMemo(() => {
        const shown = [];
        const concealed = [];
        items.forEach((item) => (hidden.has(item.id) ? concealed : shown).push(item));
        return [...shown, ...concealed];
    }, [items, hidden]);

    useLayoutEffect(() => {
        const root = rowsRef.current;
        if (!root) return;
        const next = new Map();
        root.querySelectorAll('[data-filter-id]').forEach((node) => {
            const id = node.getAttribute('data-filter-id');
            const top = node.getBoundingClientRect().top;
            const previous = positions.current.get(id);
            if (previous != null && previous !== top) {
                const delta = previous - top;
                node.style.transition = 'none';
                node.style.transform = `translateY(${delta}px)`;
                node.getBoundingClientRect();
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        node.style.transition = 'transform 220ms ease';
                        node.style.transform = '';
                    });
                });
            }
            next.set(id, top);
        });
        positions.current = next;
    }, [ordered]);

    if (items.length === 0) return null;
    return <div className="ia-filter-block">
        <div className="ia-filter-head">{label}</div>
        <div ref={rowsRef}>
            {ordered.map((item) => {
                const color = hexColor(item.color);
                const checked = !hidden.has(item.id);
                return <label
                    key={item.id}
                    data-filter-id={item.id}
                    className={checked ? 'ia-filter-row' : 'ia-filter-row is-off'}
                    title={item.title}
                    style={color ? { '--ia-swatch': color } : undefined}
                >
                    <input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />
                    <i className="ia-swatch" />
                    <span className="ia-filter-name">{item.title}</span>
                </label>;
            })}
        </div>
    </div>;
}

function AgendaPage({ t, agenda }) {
    const today = startOfDay(new Date());
    const [cursor, setCursor] = useState(() => startOfDay(new Date()));
    const [month, setMonth] = useState(() => {
        const now = new Date();
        return { year: now.getFullYear(), month: now.getMonth() };
    });
    const [viewPreference] = useState(readViewPreference);
    const [mode, setMode] = useState(viewPreference.mode);
    const [data, setData] = useState(null);
    const [loadedKey, setLoadedKey] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [revision, setRevision] = useState(0);
    const [hiddenLists, setHiddenLists] = useState(() => new Set(viewPreference.hiddenLists));
    const [hiddenCalendars, setHiddenCalendars] = useState(() => new Set(viewPreference.hiddenCalendars));
    const [reminderTitle, setReminderTitle] = useState('');
    const [eventOpen, setEventOpen] = useState(false);
    const [eventTitle, setEventTitle] = useState('');
    const [eventStart, setEventStart] = useState('');
    const [eventEnd, setEventEnd] = useState('');
    const requestRef = useRef(0);
    const overdueRef = useRef(null);
    const undatedRef = useRef(null);
    const range = useMemo(() => visibleRange(month.year, month.month), [month.year, month.month]);

    useEffect(() => {
        const requestId = ++requestRef.current;
        let active = true;
        (async () => {
            setBusy(true);
            const result = await invoke(agenda, 'snapshot', { from: range.from, to: range.to, limit: 500 });
            if (!active || requestId !== requestRef.current) return;
            setBusy(false);
            if (!result.ok) {
                setError(result.error?.code === 'ACCESS_DENIED' ? t('permission') : result.error?.message || t('unavailable'));
                return;
            }
            setError('');
            setData(result.data);
            setLoadedKey(range.key);
        })();
        return () => {
            active = false;
        };
    }, [agenda, range.from, range.to, range.key, revision]);

    useEffect(() => {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(VIEW_PREFERENCE_KEY, JSON.stringify({
                mode,
                hiddenLists: [...hiddenLists],
                hiddenCalendars: [...hiddenCalendars],
            }));
        } catch {
            // 写不进本地偏好时，当前这次选择仍然生效。
        }
    }, [mode, hiddenLists, hiddenCalendars]);

    function selectDay(date) {
        const day = startOfDay(date);
        setCursor(day);
        if (day.getFullYear() !== month.year || day.getMonth() !== month.month) {
            setMonth({ year: day.getFullYear(), month: day.getMonth() });
        }
    }

    function shiftMonth(delta) {
        const next = new Date(month.year, month.month + delta, 1);
        const year = next.getFullYear();
        const nextMonth = next.getMonth();
        setMonth({ year, month: nextMonth });
        const selectedHere = cursor.getFullYear() === year && cursor.getMonth() === nextMonth;
        if (selectedHere) return;
        const todayHere = today.getFullYear() === year && today.getMonth() === nextMonth;
        setCursor(todayHere ? today : next);
    }

    async function submit(method, input, clear) {
        setBusy(true);
        const result = await invoke(agenda, method, input);
        setBusy(false);
        if (!result.ok) {
            setError(result.error?.message || t('unavailable'));
            return;
        }
        clear();
        setRevision((value) => value + 1);
    }

    function openEvent() {
        if (!eventStart || !eventEnd) {
            const start = new Date(cursor);
            start.setHours(9, 0, 0, 0);
            const end = new Date(cursor);
            end.setHours(10, 0, 0, 0);
            if (!eventStart) setEventStart(localInputValue(start));
            if (!eventEnd) setEventEnd(localInputValue(end));
        }
        setEventOpen(true);
    }

    const ready = data && loadedKey === range.key ? data : null;
    const lists = ready?.lists ?? [];
    const calendars = ready?.calendars ?? [];
    const listIdsKey = lists.map((list) => list.id).join('\n');
    const calendarIdsKey = calendars.map((calendar) => calendar.id).join('\n');
    const listColors = new Map(lists.map((list) => [list.id, hexColor(list.color)]));
    const calendarColors = new Map(calendars.map((calendar) => [calendar.id, hexColor(calendar.color)]));
    const reminders = (ready?.reminders ?? []).filter((item) => !item.completed && !hiddenLists.has(item.listId));
    const events = (ready?.events ?? []).filter((item) => !hiddenCalendars.has(item.calendarId));

    useEffect(() => {
        if (!ready) return;
        const listIds = new Set(listIdsKey ? listIdsKey.split('\n') : []);
        const calendarIds = new Set(calendarIdsKey ? calendarIdsKey.split('\n') : []);
        setHiddenLists((current) => {
            const next = [...current].filter((id) => listIds.has(id));
            return next.length === current.size ? current : new Set(next);
        });
        setHiddenCalendars((current) => {
            const next = [...current].filter((id) => calendarIds.has(id));
            return next.length === current.size ? current : new Set(next);
        });
    }, [ready, listIdsKey, calendarIdsKey]);

    function toggleHidden(kind, id) {
        const setter = kind === 'list' ? setHiddenLists : setHiddenCalendars;
        setter((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }
    const overdueIds = new Set(reminders.filter((item) => isOverdue(item, today)).map((item) => item.id));
    const weekDays = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(cursor), index));
    const visibleDays = mode === 'week' ? weekDays : [cursor];
    const shownIds = new Set(visibleDays.flatMap((day) => reminders.filter((item) => reminderOnDay(item, day)).map((item) => item.id)));
    const overdueItems = reminders.filter((item) => overdueIds.has(item.id) && !shownIds.has(item.id))
        .sort((left, right) => (parseDate(left.due)?.getTime() ?? 0) - (parseDate(right.due)?.getTime() ?? 0));
    const undatedItems = reminders.filter((item) => !item.due);
    const marks = new Map(range.days.map((day) => {
        const key = dayKey(day);
        const dayEvents = events.filter((event) => eventOverlapsDay(event, day));
        const dayReminders = reminders.filter((item) => reminderOnDay(item, day));
        return [key, {
            event: dayEvents.length > 0,
            reminder: dayReminders.length > 0,
            eventColor: soleAccent(dayEvents.map((event) => calendarColors.get(event.calendarId))),
            reminderColor: soleAccent(dayReminders.map((item) => listColors.get(item.listId))),
        }];
    }));

    function scrollTo(target) {
        target.current?.scrollIntoView({ block: 'start' });
    }

    const dayList = dayBlocks(cursor, events, reminders);
    const weekLabel = `${shortDate(weekDays[0])} – ${shortDate(weekDays[6])}`;

    return <section className="ios-agenda" aria-busy={busy}>
        <style>{css}</style>
        <div className="ia-body">
            <aside className="ia-side">
                <div className="ia-month">
                    <button type="button" aria-label={t('prevMonth')} onClick={() => shiftMonth(-1)}>‹</button>
                    <strong>{monthHeading(month.year, month.month)}</strong>
                    <button type="button" aria-label={t('nextMonth')} onClick={() => shiftMonth(1)}>›</button>
                </div>
                <div className="ia-weekdays" aria-hidden="true">
                    {Array.from({ length: 7 }, (_, index) => <span key={index}>{weekdayNarrow(index)}</span>)}
                </div>
                <div className="ia-cal">
                    {range.days.map((day) => {
                        const outside = day.getMonth() !== month.month;
                        const selected = sameDay(day, cursor);
                        const mark = marks.get(dayKey(day)) ?? { event: false, reminder: false };
                        const className = [
                            'ia-day',
                            outside ? 'is-outside' : '',
                            sameDay(day, today) ? 'is-today' : '',
                            selected ? 'is-selected' : '',
                        ].filter(Boolean).join(' ');
                        return <button
                            key={dayKey(day)}
                            type="button"
                            className={className}
                            aria-current={sameDay(day, today) ? 'date' : undefined}
                            aria-pressed={selected}
                            onClick={() => selectDay(day)}
                        >
                            <span>{day.getDate()}</span>
                            <span className="ia-dots">
                                {mark.event ? <i className="ia-dot ia-dot-event" style={mark.eventColor ? { background: mark.eventColor } : undefined} /> : null}
                                {mark.reminder ? <i className="ia-dot ia-dot-reminder" style={mark.reminderColor ? { background: mark.reminderColor } : undefined} /> : null}
                            </span>
                        </button>;
                    })}
                </div>
                <div className="ia-jumps">
                    {overdueItems.length > 0 && <button type="button" className="ia-jump-overdue" onClick={() => scrollTo(overdueRef)}>
                        {t('overdue')}<strong>{overdueItems.length}</strong>
                    </button>}
                    {undatedItems.length > 0 && <button type="button" onClick={() => scrollTo(undatedRef)}>
                        {t('undated')}<strong>{undatedItems.length}</strong>
                    </button>}
                </div>
                <FilterList label={t('lists')} items={lists} hidden={hiddenLists} onToggle={(id) => toggleHidden('list', id)} />
                <FilterList label={t('calendars')} items={calendars} hidden={hiddenCalendars} onToggle={(id) => toggleHidden('calendar', id)} />
            </aside>
            <div className="ia-board">
                <div className="ia-board-scroll">
                    <header className="ia-board-head">
                        <h1>{mode === 'week' ? weekLabel : dayHeading(cursor)}</h1>
                        <div className="ia-modes" role="group">
                            <button type="button" aria-pressed={mode === 'day' && sameDay(cursor, today)} onClick={() => { setMode('day'); selectDay(today); }}>{t('today')}</button>
                            <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>{t('week')}</button>
                        </div>
                        <button type="button" className="ia-refresh" onClick={() => setRevision((value) => value + 1)} disabled={busy}>{t('refresh')}</button>
                    </header>
                    {error && <p className="ios-agenda-error" role="alert">{error}</p>}
                    {!ready && !error && <p className="ios-agenda-muted">{t('loading')}</p>}
                    {ready && mode === 'day' && <section className="ia-day-list">
                        {dayList.length
                            ? <AgendaBlocks blocks={dayList} overdueIds={overdueIds} listColors={listColors} calendarColors={calendarColors} t={t} busy={busy} onComplete={(id) => submit('completeReminder', { id, completed: true }, () => {})} onDelete={(method, id) => submit(method, { id }, () => {})} />
                            : <p className="ios-agenda-muted">{t('emptyDay')}</p>}
                    </section>}
                    {ready && mode === 'week' && <div className="ia-week-scroll">
                        <div className="ia-week">
                            {weekDays.map((day) => {
                                const blocks = dayBlocks(day, events, reminders);
                                return <section key={dayKey(day)} className={sameDay(day, cursor) ? 'ia-week-col is-selected' : 'ia-week-col'}>
                                    <button type="button" className={sameDay(day, today) ? 'ia-week-head is-today' : 'ia-week-head'} onClick={() => selectDay(day)}>
                                        <span>{weekdayShort(day)}</span>
                                        <strong>{day.getDate()}</strong>
                                    </button>
                                    <AgendaBlocks compact blocks={blocks} overdueIds={overdueIds} listColors={listColors} calendarColors={calendarColors} t={t} busy={busy} onComplete={(id) => submit('completeReminder', { id, completed: true }, () => {})} onDelete={(method, id) => submit(method, { id }, () => {})} />
                                </section>;
                            })}
                        </div>
                    </div>}
                    {ready && overdueItems.length > 0 && <section className="ia-group" ref={overdueRef}>
                        <h2>{t('overdue')}</h2>
                        {overdueItems.map((item) => <AgendaRow
                            key={`overdue:${item.id}`}
                            time={overdueTimeLabel(item)}
                            title={item.title}
                            source={item.list}
                            notes={item.notes}
                            overdue
                            accent={listColors.get(item.listId) || ''}
                            onComplete={() => submit('completeReminder', { id: item.id, completed: true }, () => {})}
                            onDelete={() => submit('deleteReminder', { id: item.id }, () => {})}
                            t={t}
                            busy={busy}
                        />)}
                    </section>}
                    {ready && undatedItems.length > 0 && <section className="ia-group" ref={undatedRef}>
                        <h2>{t('undated')}</h2>
                        {undatedItems.map((item) => <AgendaRow
                            key={`undated:${item.id}`}
                            time=""
                            title={item.title}
                            source={item.list}
                            notes={item.notes}
                            accent={listColors.get(item.listId) || ''}
                            onComplete={() => submit('completeReminder', { id: item.id, completed: true }, () => {})}
                            onDelete={() => submit('deleteReminder', { id: item.id }, () => {})}
                            t={t}
                            busy={busy}
                        />)}
                    </section>}
                </div>
                <form className="ia-composer" onSubmit={(event) => {
                    event.preventDefault();
                    if (!reminderTitle.trim()) return;
                    submit('createReminder', { title: reminderTitle.trim() }, () => setReminderTitle(''));
                }}>
                    <input aria-label={t('titleField')} value={reminderTitle} placeholder={t('newReminder')} onChange={(event) => setReminderTitle(event.target.value)} />
                    <button type="submit" disabled={busy || !reminderTitle.trim()}>{t('add')}</button>
                    <button type="button" onClick={() => (eventOpen ? setEventOpen(false) : openEvent())}>{t('newEvent')}</button>
                </form>
                {eventOpen && <form className="ia-event-form" onSubmit={(event) => {
                    event.preventDefault();
                    if (!eventTitle.trim() || !eventStart || !eventEnd) return;
                    submit('createEvent', {
                        title: eventTitle.trim(),
                        start: new Date(eventStart).toISOString(),
                        end: new Date(eventEnd).toISOString(),
                    }, () => {
                        setEventTitle('');
                        setEventStart('');
                        setEventEnd('');
                        setEventOpen(false);
                    });
                }}>
                    <input aria-label={t('titleField')} value={eventTitle} placeholder={t('newEvent')} onChange={(event) => setEventTitle(event.target.value)} />
                    <input aria-label={t('start')} type="datetime-local" value={eventStart} onChange={(event) => setEventStart(event.target.value)} />
                    <input aria-label={t('end')} type="datetime-local" value={eventEnd} onChange={(event) => setEventEnd(event.target.value)} />
                    <button type="submit" disabled={busy || !eventTitle.trim() || !eventStart || !eventEnd}>{t('add')}</button>
                </form>}
            </div>
        </div>
    </section>;
}

const css = `
.ios-agenda { --ia-danger: var(--dsw-alias-state-danger, #d14343); box-sizing: border-box; height: 100%; overflow: hidden; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
.ios-agenda * { box-sizing: border-box; }
.ios-agenda button, .ios-agenda input { font: inherit; color: inherit; }
.ia-body { height: 100%; display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 0; }
.ia-side { min-height: 0; overflow: auto; padding: 16px 16px 20px; border-right: 1px solid var(--dsw-alias-border-default); }
.ia-month { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.ia-month strong { font-size: 15px; font-weight: 600; }
.ia-month button, .ia-refresh, .ia-composer button, .ia-event-form button { border: 1px solid var(--dsw-alias-border-default); background: var(--dsw-alias-bg-layer-1); border-radius: 8px; padding: 4px 10px; cursor: pointer; }
.ia-month button { width: 32px; height: 32px; padding: 0; border: none; background: transparent; }
.ia-month button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ia-composer button[type="submit"], .ia-event-form button[type="submit"] { border-color: transparent; background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-bg-base); }
.ia-weekdays, .ia-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.ia-weekdays { margin-bottom: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; }
.ia-day { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; aspect-ratio: 1; border: none; border-radius: 8px; background: transparent; cursor: pointer; padding: 0; }
.ia-day:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ia-day.is-outside { color: var(--dsw-alias-label-secondary); opacity: 0.45; }
.ia-day.is-today > span:first-child { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
.ia-day.is-selected { background: var(--dsw-alias-bg-layer-1); box-shadow: inset 0 0 0 1.5px var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary); opacity: 1; }
.ia-day:focus-visible, .ia-week-head:focus-visible, .ia-modes button:focus-visible, .ia-filter-row:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.ia-dots { display: flex; gap: 3px; height: 5px; }
.ia-dot { width: 5px; height: 5px; border-radius: 50%; }
.ia-dot-event { background: var(--dsw-alias-state-business-primary); }
.ia-dot-reminder { background: var(--dsw-alias-label-secondary); }
.ia-jumps { display: flex; flex-direction: column; gap: 4px; margin-top: 14px; }
.ia-jumps button, .ia-modes button, .ia-filter-row { border: none; background: transparent; border-radius: 8px; cursor: pointer; }
.ia-jumps button { display: flex; justify-content: space-between; width: 100%; padding: 6px 8px; text-align: left; }
.ia-jumps button:hover, .ia-modes button:hover, .ia-filter-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ia-jumps strong { font-weight: 600; }
.ia-jump-overdue strong { color: var(--ia-danger); }
.ia-filter-block { margin-top: 16px; }
.ia-filter-head { margin: 0 8px 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ia-filter-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px; text-align: left; color: var(--dsw-alias-label-primary); cursor: pointer; }
.ia-filter-row.is-off { color: var(--dsw-alias-label-secondary); }
.ia-filter-row.is-off .ia-swatch { opacity: 0.4; }
.ia-filter-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ia-swatch { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--ia-swatch, var(--dsw-alias-label-secondary)); }
.ia-board { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.ia-board-scroll { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px 8px; }
.ia-board-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding-bottom: 10px; background: var(--dsw-alias-bg-base); }
.ia-board-head h1 { margin: 0; flex: 1; min-width: 0; font-size: 22px; font-weight: 600; }
.ia-modes { display: flex; gap: 2px; padding: 2px; border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.ia-modes button { padding: 6px 10px; color: var(--dsw-alias-label-secondary); }
.ia-modes button[aria-pressed="true"] { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-default); }
.ia-row, .ia-compact { box-shadow: inset 3px 0 0 var(--ia-accent, transparent); }
.ia-row { display: grid; grid-template-columns: 16px 9.5rem minmax(0, 1fr) auto auto auto; gap: 12px; align-items: center; padding: 8px 10px; border-radius: 8px; }
.ia-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ia-check-spacer { width: 16px; height: 16px; }
.ia-time { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.ia-main { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.ia-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.ia-source, .ia-location, .ia-detail, .ios-agenda-muted { color: var(--dsw-alias-label-secondary); }
.ia-source, .ia-location { white-space: nowrap; font-size: 13px; }
.ia-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 400; }
.ia-delete { opacity: 0; border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 4px 6px; }
.ia-row:hover .ia-delete, .ia-compact:hover .ia-delete, .ia-delete:focus-visible { opacity: 1; }
.is-overdue .ia-time { color: var(--ia-danger); }
.ia-group { margin-top: 22px; scroll-margin-top: 64px; }
.ia-group h2 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.ia-week-scroll { overflow-x: auto; }
.ia-week { display: grid; grid-template-columns: repeat(7, minmax(160px, 1fr)); gap: 8px; min-width: 100%; }
.ia-week-col { min-width: 0; padding: 8px; border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.ia-week-col.is-selected { box-shadow: inset 0 0 0 1.5px var(--dsw-alias-state-business-primary); }
.ia-week-head { display: flex; justify-content: space-between; width: 100%; margin-bottom: 8px; border: none; background: transparent; cursor: pointer; padding: 2px 2px 6px; color: var(--dsw-alias-label-secondary); }
.ia-week-head strong { color: var(--dsw-alias-label-primary); }
.ia-week-head.is-today strong { color: var(--dsw-alias-state-business-primary); }
.ia-compact { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 6px 4px; border-radius: 8px; }
.ia-compact:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ia-compact-top { display: flex; align-items: center; gap: 6px; min-height: 18px; }
.ia-compact .ia-title, .ia-compact .ia-source { display: block; }
.ia-compact .ia-source { font-size: 12px; }
.ia-compact .ia-delete { position: absolute; top: 2px; right: 0; }
.ia-composer, .ia-event-form { display: flex; gap: 8px; align-items: center; padding: 10px 24px; }
.ia-composer { border-top: 1px solid var(--dsw-alias-border-default); }
.ia-event-form { padding-top: 0; padding-bottom: 14px; }
.ia-composer input, .ia-event-form input { flex: 1; min-width: 0; border: 1px solid var(--dsw-alias-border-default); background: var(--dsw-alias-bg-layer-1); border-radius: 8px; padding: 8px 10px; }
.ios-agenda-error { margin: 0 0 12px; padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.ios-agenda input[type="checkbox"] { width: 16px; height: 16px; margin: 0; accent-color: var(--dsw-alias-state-business-primary); }
.ia-filter-row input[type="checkbox"] { flex: none; accent-color: var(--ia-swatch, var(--dsw-alias-state-business-primary)); }
button:disabled { cursor: default; opacity: 0.6; }
@media (max-width: 860px) {
  .ia-body { grid-template-columns: 1fr; }
  .ia-side { border-right: none; border-bottom: 1px solid var(--dsw-alias-border-default); }
  .ia-cal { max-width: 320px; }
}
`;

export const inject = ['slots', 'locale', 'remote'];

export async function apply(ctx) {
    const release = await ctx.remote.$mount(contribution);
    ctx.effect(() => release);
    await ctx.plugin({
        name: `${contribution.package}/page`,
        inject: ['slots', 'locale', 'layout', `remote.${SERVICE}`],
        apply(pageCtx) {
            const agenda = pageCtx.remote[SERVICE];
            pageCtx.effect(() => pageCtx.locale.register(NS, { zh, en }));
            const t = pageCtx.locale.bind(NS);
            pageCtx.effect(() => pageCtx.slots.inject('main', () => pageCtx.slots.register({
                name: 'main',
                key: PANEL_ID,
                locale: NS,
                inject: () => ({ agenda }),
            }, AgendaPage)));
            // 官方 panellist 在「历史会话」下面。这里跟 session-reader 一样插按钮，并钉在它前面。
            pageCtx.effect(() => mountSidebarEntry({
                label: () => t('panel'),
                onOpen: () => {
                    try {
                        pageCtx.layout.selectPanel(PANEL_ID);
                    } catch (error) {
                        console.error('[ios-agenda] 无法打开页面', error);
                    }
                },
            }));
        },
    });
}
