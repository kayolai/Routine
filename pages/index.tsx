import { useEffect, useState } from "react";
import type { CalendarEvent } from "./api/calendar";
import type { SyncTask } from "./api/sync";

// ── Types ─────────────────────────────────────────────────────────────────────

type CalendarState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; events: CalendarEvent[] };

interface RoutineTask {
  id: string;
  name: string;
  duration: number; // minutes
}

interface ScheduleBlock {
  id: string;
  type: "event" | "task" | "free";
  title: string;
  start: number; // minutes since midnight
  end: number;
  isRoutine?: boolean;    // vrai pour les événements créés par routine-boss
  isCompleted?: boolean;  // titre commence par "[✔]" dans Google Calendar
}

interface DaySchedule {
  date: Date;
  label: string; // "lundi 23 février"
  blocks: ScheduleBlock[];
}

interface WeekScheduleResult {
  days: DaySchedule[];
  unscheduled: RoutineTask[];
}

type SyncState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; count: number; deleted: number }
  | { status: "error"; message: string };

// ── Constantes ────────────────────────────────────────────────────────────────

const WORK_START = 8 * 60;  // 08:00 → 480 min
const WORK_END   = 20 * 60; // 20:00 → 1200 min

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Construit une chaîne datetime locale "YYYY-MM-DDTHH:MM:00" sans conversion UTC. */
function toLocalIso(day: Date, minutes: number): string {
  const y = day.getFullYear();
  const m = String(day.getMonth() + 1).padStart(2, "0");
  const d = String(day.getDate()).padStart(2, "0");
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const min = String(minutes % 60).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}:00`;
}

function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function formatDate(dateStr: string, isAllDay: boolean): string {
  if (!dateStr) return "Date inconnue";
  const date = new Date(dateStr);
  if (isAllDay) {
    return date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" });
  }
  return date.toLocaleString("fr-FR", {
    weekday: "short", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Algorithme ────────────────────────────────────────────────────────────────

/**
 * Remplit un jour donné avec les tâches de la file d'attente.
 * Retourne les blocs affichables + les tâches effectivement placées + la file restante.
 */
function fillDay(
  date: Date,
  events: CalendarEvent[],
  taskQueue: RoutineTask[],
  dayStart: number = WORK_START
): { blocks: ScheduleBlock[]; remaining: RoutineTask[] } {
  const dayTs = date.getTime();
  const effectiveStart = Math.min(Math.max(dayStart, WORK_START), WORK_END);

  // Événements du jour, convertis en minutes et clippés sur la plage de travail
  const eventBlocks: ScheduleBlock[] = events
    .filter((e) => {
      if (e.isAllDay) return false;
      const d = new Date(e.start);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === dayTs;
    })
    .map((e) => {
      const s = new Date(e.start);
      const end = e.end ? new Date(e.end) : new Date(s.getTime() + 3_600_000);
      return {
        id: e.id,
        type: "event" as const,
        title: e.title,
        start: Math.max(s.getHours() * 60 + s.getMinutes(), effectiveStart),
        end:   Math.min(end.getHours() * 60 + end.getMinutes(), WORK_END),
        isRoutine: e.isRoutine,
        isCompleted: e.isCompleted,
      };
    })
    .filter((b) => b.start < b.end)
    .sort((a, b) => a.start - b.start);

  // Créneaux libres entre les événements fixes (à partir de effectiveStart)
  const slots: { start: number; end: number }[] = [];
  let cursor = effectiveStart;
  for (const b of eventBlocks) {
    if (b.start > cursor) slots.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < WORK_END) slots.push({ start: cursor, end: WORK_END });

  // Placement greedy : on consomme la file d'attente dans l'ordre
  const taskBlocks: ScheduleBlock[] = [];
  const remaining: RoutineTask[] = [];
  const mutableSlots = slots.map((s) => ({ ...s }));

  for (const task of taskQueue) {
    let placed = false;
    for (const slot of mutableSlots) {
      if (slot.end - slot.start >= task.duration) {
        taskBlocks.push({
          id: `${task.id}-${dayTs}`,
          type: "task",
          title: task.name,
          start: slot.start,
          end:   slot.start + task.duration,
          isRoutine: true,
        });
        slot.start += task.duration;
        placed = true;
        break;
      }
    }
    if (!placed) remaining.push(task);
  }

  // Fusion chronologique + remplissage des trous avec des blocs "Temps libre"
  const sorted = [...eventBlocks, ...taskBlocks].sort((a, b) => a.start - b.start);
  const allBlocks: ScheduleBlock[] = [];
  let c = effectiveStart;
  for (const b of sorted) {
    if (b.start > c) {
      allBlocks.push({ id: `free-${dayTs}-${c}`, type: "free", title: "Temps libre", start: c, end: b.start });
    }
    allBlocks.push(b);
    c = b.end;
  }
  if (c < WORK_END) {
    allBlocks.push({ id: `free-${dayTs}-${c}`, type: "free", title: "Temps libre", start: c, end: WORK_END });
  }

  return { blocks: allBlocks, remaining };
}

/**
 * Distribue la file des tâches sur une fenêtre glissante de 7 jours.
 * Les tâches non placées le jour J basculent automatiquement au jour J+1.
 */
function generateWeekSchedule(
  events: CalendarEvent[],
  tasks: RoutineTask[]
): WeekScheduleResult {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // Pour aujourd'hui, le planning commence à l'heure actuelle (arrondie à la minute)
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Exclure les routines déjà verrouillées dans GCal — elles ne doivent pas bloquer les créneaux
  const fixedEvents = events.filter((e) => !e.isRoutine);

  let taskQueue = [...tasks];
  const days: DaySchedule[] = [];

  for (let i = 0; i < 7; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() + i);

    const dayStart = i === 0 ? currentMinutes : WORK_START;
    const { blocks, remaining } = fillDay(day, fixedEvents, taskQueue, dayStart);
    taskQueue = remaining;

    days.push({
      date: day,
      label: day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
      blocks,
    });
  }

  return { days, unscheduled: taskQueue };
}

// ── Composant principal ───────────────────────────────────────────────────────

export default function Home() {
  const [calendarState, setCalendarState] = useState<CalendarState>({ status: "loading" });
  const [isMounted, setIsMounted] = useState(false);
  const [tasks, setTasks] = useState<RoutineTask[]>([]);
  const [taskName, setTaskName] = useState("");
  const [taskDuration, setTaskDuration] = useState("");
  const [weekSchedule, setWeekSchedule] = useState<WeekScheduleResult | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ status: "idle" });
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem("routine-tasks");
      if (stored) setTasks(JSON.parse(stored) as RoutineTask[]);
    } catch { /* localStorage indisponible */ }
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem("routine-tasks", JSON.stringify(tasks));
    }
  }, [tasks, isMounted]);

  useEffect(() => {
    fetch("/api/calendar")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setCalendarState({ status: "error", message: data.error });
        } else {
          setCalendarState({ status: "success", events: data.events });
        }
      })
      .catch((err: Error) => setCalendarState({ status: "error", message: err.message }));
  }, []);

  useEffect(() => {
    if (calendarState.status === "success") {
      setWeekSchedule(generateWeekSchedule(calendarState.events, tasks));
    }
  }, [calendarState]);

  function handleAddTask(e: React.FormEvent) {
    e.preventDefault();
    const duration = parseInt(taskDuration, 10);
    if (!taskName.trim() || isNaN(duration) || duration <= 0) return;
    setTasks((prev) => [...prev, { id: crypto.randomUUID(), name: taskName.trim(), duration }]);
    setTaskName("");
    setTaskDuration("");
  }

  function handleDeleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function handleGenerate() {
    const events = calendarState.status === "success" ? calendarState.events : [];
    setWeekSchedule(generateWeekSchedule(events, tasks));
    setSyncState({ status: "idle" });
  }

  function handleComplete(blockId: string, isGCalEvent: boolean, currentlyDone: boolean) {
    // Toggle optimiste : on inverse l'état dans le Set local
    setCompletedIds((prev) => {
      const next = new Set(prev);
      next.has(blockId) ? next.delete(blockId) : next.add(blockId);
      return next;
    });
    // Les blocs type "task" n'ont pas encore d'ID GCal → pas d'appel API
    if (!isGCalEvent) return;
    fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId: blockId, completed: !currentlyDone }),
    }).catch(() => {
      // Rollback : on re-bascule au même état qu'avant
      setCompletedIds((prev) => {
        const next = new Set(prev);
        next.has(blockId) ? next.delete(blockId) : next.add(blockId);
        return next;
      });
    });
  }

  async function handleLock() {
    if (!weekSchedule) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const syncTasks: SyncTask[] = weekSchedule.days.flatMap((day) =>
      day.blocks
        .filter((b) => b.type === "task")
        .map((b) => ({
          title: b.title,
          startIso: toLocalIso(day.date, b.start),
          endIso:   toLocalIso(day.date, b.end),
          timezone: tz,
        }))
    );

    if (syncTasks.length === 0) return;

    setSyncState({ status: "loading" });
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: syncTasks }),
      });
      const data = await res.json();
      if (data.error) {
        setSyncState({ status: "error", message: data.error });
      } else {
        setSyncState({ status: "success", count: data.created, deleted: data.deleted });
      }
    } catch (err) {
      setSyncState({ status: "error", message: (err as Error).message });
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-6">
      <h1 className="text-3xl font-bold text-gray-800 mb-8">Planificateur</h1>

      {/* ── Deux colonnes ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

        {/* Colonne gauche — Agenda de la semaine */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Agenda de la semaine</h2>

          {calendarState.status === "loading" && (
            <p className="text-gray-500 animate-pulse">Chargement…</p>
          )}

          {calendarState.status === "error" && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              <span className="font-semibold">Erreur : </span>{calendarState.message}
            </div>
          )}

          {calendarState.status === "success" && calendarState.events.length === 0 && (
            <p className="text-gray-500">Aucun événement cette semaine.</p>
          )}

          {calendarState.status === "success" && calendarState.events.length > 0 && (
            <ul className="space-y-3">
              {calendarState.events.map((event) => (
                <li key={event.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                  <p className="font-semibold text-gray-800">{event.title}</p>
                  <p className="text-sm text-gray-500 mt-1">{formatDate(event.start, event.isAllDay)}</p>
                  {event.location && (
                    <p className="text-sm text-gray-400 mt-0.5">📍 {event.location}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Colonne droite — Tâches de routine */}
        <section>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Tâches de routine</h2>

          <form
            onSubmit={handleAddTask}
            className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4 mb-5"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom de la tâche</label>
              <input
                type="text"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                placeholder="Ex : Lecture, Sport…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Durée estimée (en minutes)
              </label>
              <input
                type="number"
                min={1}
                value={taskDuration}
                onChange={(e) => setTaskDuration(e.target.value)}
                placeholder="Ex : 30"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
            >
              Ajouter la tâche
            </button>
          </form>

          {isMounted && tasks.length === 0 && (
            <p className="text-gray-400 text-sm mb-6">Aucune tâche ajoutée.</p>
          )}

          {isMounted && tasks.length > 0 && (
            <ul className="space-y-2 mb-6">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{task.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{task.duration} min</p>
                  </div>
                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                    aria-label="Supprimer"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Bouton principal */}
          <button
            onClick={handleGenerate}
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold text-xl py-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 active:scale-[0.98]"
          >
            Générer ma semaine
          </button>
        </section>
      </div>

      {/* ── Planning hebdomadaire ──────────────────────────────────────────── */}
      {weekSchedule && (
        <section className="mt-14">
          <h2 className="text-xl font-bold text-gray-800 mb-6">Planning de la semaine</h2>

          <div className="space-y-5">
            {weekSchedule.days.map((day, i) => {
              const isToday = i === 0;
              const taskCount = day.blocks.filter((b) => b.type === "task").length;

              return (
                <div
                  key={day.date.getTime()}
                  className="rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  {/* En-tête du jour */}
                  <div className={`flex items-center justify-between px-5 py-3 ${
                    isToday
                      ? "bg-violet-600"
                      : "bg-gray-50 border-b border-gray-200"
                  }`}>
                    <p className={`font-bold capitalize text-sm ${
                      isToday ? "text-white" : "text-gray-700"
                    }`}>
                      {isToday ? "Aujourd'hui · " : ""}{day.label}
                    </p>
                    {taskCount > 0 && (
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                        isToday
                          ? "bg-white/20 text-white"
                          : "bg-emerald-100 text-emerald-700"
                      }`}>
                        {taskCount} routine{taskCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {/* Blocs du jour */}
                  <div className="bg-white divide-y divide-gray-50">
                    {day.blocks.map((block) => {
                      const duration  = block.end - block.start;
                      const isEvent   = block.type === "event";
                      const isTask    = block.type === "task";
                      // Source de vérité : isCompleted (titre GCal), surchargé par les actions de la session
                      const baseCompleted = block.isCompleted ?? false;
                      const isDone = block.isRoutine
                        ? (completedIds.has(block.id) ? !baseCompleted : baseCompleted)
                        : false;

                      return (
                        <div
                          key={block.id}
                          className={`flex items-center gap-3 px-5 py-2.5 transition-colors ${
                            isDone    ? "bg-gray-50 opacity-60" :
                            isEvent   ? "bg-indigo-50/60" :
                            isTask    ? "bg-emerald-50/60" :
                                        ""
                          }`}
                        >
                          {/* Checkbox visible uniquement sur les routines Google Calendar */}
                          {block.isRoutine ? (
                            <input
                              type="checkbox"
                              checked={isDone}
                              onChange={() => handleComplete(block.id, block.type === "event", isDone)}
                              className="w-4 h-4 shrink-0 accent-emerald-500 cursor-pointer"
                              aria-label={`Marquer "${block.title}" comme terminé`}
                            />
                          ) : (
                            <div className="w-4 shrink-0" />
                          )}

                          {/* Plage horaire */}
                          <div className="font-mono text-xs text-gray-400 w-24 shrink-0">
                            {minutesToTime(block.start)}–{minutesToTime(block.end)}
                          </div>

                          {/* Barre colorée */}
                          <div className={`w-0.5 self-stretch rounded-full shrink-0 ${
                            isDone    ? "bg-gray-300" :
                            isEvent   ? "bg-indigo-300" :
                            isTask    ? "bg-emerald-300" :
                                        "bg-gray-200"
                          }`} />

                          {/* Titre */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate ${
                              isDone    ? "line-through text-gray-400" :
                              isEvent   ? "font-medium text-indigo-800" :
                              isTask    ? "font-medium text-emerald-800" :
                                          "text-gray-400 italic"
                            }`}>
                              {block.title}
                            </p>
                          </div>

                          {/* Durée */}
                          <span className="text-xs text-gray-400 shrink-0">{duration} min</span>

                          {/* Badge type */}
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                            isDone    ? "bg-gray-100 text-gray-400" :
                            isEvent   ? "bg-indigo-100 text-indigo-600" :
                            isTask    ? "bg-emerald-100 text-emerald-600" :
                                        "bg-gray-100 text-gray-400"
                          }`}>
                            {isEvent ? "Événement" : isTask ? "Routine" : "Libre"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tâches non planifiées sur les 7 jours */}
          {weekSchedule.unscheduled.length > 0 && (
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-5">
              <p className="font-semibold text-amber-700 mb-3">
                ⚠ {weekSchedule.unscheduled.length} tâche{weekSchedule.unscheduled.length > 1 ? "s" : ""} non planifiée{weekSchedule.unscheduled.length > 1 ? "s" : ""} — aucun créneau suffisant sur 7 jours
              </p>
              <ul className="space-y-1">
                {weekSchedule.unscheduled.map((t) => (
                  <li key={t.id} className="text-sm text-amber-600">
                    · {t.name} ({t.duration} min)
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Verrouillage ─────────────────────────────────────────────── */}
          {weekSchedule.days.some((d) => d.blocks.some((b) => b.type === "task")) && (
            <div className="mt-8">
              <button
                onClick={handleLock}
                disabled={syncState.status === "loading" || syncState.status === "success"}
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-bold text-xl py-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 active:scale-[0.98]"
              >
                {syncState.status === "loading" ? "Synchronisation…" : "Verrouiller mon emploi du temps"}
              </button>

              {syncState.status === "success" && (
                <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4 text-emerald-700 text-sm font-medium">
                  ✓ {syncState.count} événement{syncState.count > 1 ? "s" : ""} créé{syncState.count > 1 ? "s" : ""} dans Google Calendar avec rappel à 10 min.
                  {syncState.deleted > 0 && (
                    <span className="text-emerald-500 font-normal ml-1">
                      ({syncState.deleted} ancien{syncState.deleted > 1 ? "s" : ""} supprimé{syncState.deleted > 1 ? "s" : ""})
                    </span>
                  )}
                </div>
              )}

              {syncState.status === "error" && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 text-sm">
                  <span className="font-semibold">Erreur : </span>{syncState.message}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
