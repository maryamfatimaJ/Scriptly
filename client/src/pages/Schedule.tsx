import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/Button";
import { ReminderRow } from "@/components/ReminderRow";
import { ScheduleCard } from "@/components/ScheduleCard";
import { CreateScheduleForm } from "@/components/CreateScheduleForm";
import { AddMedicineForm } from "@/components/AddMedicineForm";
import * as scheduleApi from "@/api/schedule";
import * as medicationsApi from "@/api/medications";

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

type ViewMode = "day" | "week";

export function SchedulePage() {
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(new Date()));
  const [view, setView] = useState<ViewMode>("day");
  const [schedulingMedicationId, setSchedulingMedicationId] = useState<string | null>(null);
  const [addingMedicine, setAddingMedicine] = useState(false);

  const dayQuery = useQuery({
    queryKey: ["schedule", "day", selectedDate],
    queryFn: () => scheduleApi.getScheduleForDate(selectedDate),
    enabled: view === "day",
  });

  const weekQuery = useQuery({
    queryKey: ["schedule", "week", selectedDate],
    queryFn: () => scheduleApi.getScheduleForWeek(selectedDate),
    enabled: view === "week",
  });

  const schedulesQuery = useQuery({
    queryKey: ["schedules"],
    queryFn: scheduleApi.listSchedules,
  });

  const { data: medicationsData } = useQuery({
    queryKey: ["medications"],
    queryFn: medicationsApi.listMedications,
  });

  // Only offer "set up reminders" for a confirmed medication that doesn't
  // already have an active or paused schedule — a medication that was
  // discontinued (all its schedules CANCELLED) can be scheduled again.
  const confirmedWithoutSchedule = (medicationsData?.medications ?? []).filter(
    (m) => m.reviewStatus === "CONFIRMED" && !(m.schedules ?? []).some((s) => s.status === "ACTIVE" || s.status === "PAUSED")
  );

  function shiftDate(days: number) {
    const next = new Date(`${selectedDate}T00:00:00`);
    next.setDate(next.getDate() + days * (view === "week" ? 7 : 1));
    setSelectedDate(toDateInputValue(next));
  }

  const dayReminders = dayQuery.data?.reminders ?? [];
  const weekDays = weekQuery.data?.days ?? {};
  const sortedWeekDates = Object.keys(weekDays).sort();

  return (
    <div className="mx-auto max-w-content px-6 py-16 sm:py-20">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-forest">Routine</p>
          <h1 className="font-display text-4xl">Schedule</h1>
        </div>
        <div className="flex rounded-capsule border border-charcoal/15 p-1 text-sm">
          <button
            onClick={() => setView("day")}
            className={`rounded-capsule px-4 py-1.5 ${view === "day" ? "bg-forest text-offwhite" : "text-charcoal/70"}`}
          >
            Day
          </button>
          <button
            onClick={() => setView("week")}
            className={`rounded-capsule px-4 py-1.5 ${view === "week" ? "bg-forest text-offwhite" : "text-charcoal/70"}`}
          >
            Week
          </button>
        </div>
      </header>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => shiftDate(-1)} aria-label={view === "week" ? "Previous week" : "Previous day"}>
            ←
          </Button>
          <div className="text-lg font-medium">
            {view === "day" ? formatDateLabel(selectedDate) : `Week of ${formatDateLabel(selectedDate)}`}
          </div>
          <Button variant="secondary" onClick={() => shiftDate(1)} aria-label={view === "week" ? "Next week" : "Next day"}>
            →
          </Button>
        </div>
        <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="field" />
      </div>

      {view === "day" ? (
        <div className="mt-10 flex flex-col gap-4">
          {dayQuery.isLoading && <p className="text-charcoal/70">Loading…</p>}
          {!dayQuery.isLoading && dayReminders.length === 0 && (
            <div className="rounded-3xl border border-dashed border-charcoal/20 p-8 text-charcoal/70">No reminders for this day.</div>
          )}
          {dayReminders.map((reminder) => (
            <ReminderRow key={reminder.id} reminder={reminder} queryKey={["schedule", "day", selectedDate]} />
          ))}
        </div>
      ) : (
        <div className="mt-10 flex flex-col gap-6">
          {weekQuery.isLoading && <p className="text-charcoal/70">Loading…</p>}
          {sortedWeekDates.length === 0 && !weekQuery.isLoading && (
            <div className="rounded-3xl border border-dashed border-charcoal/20 p-8 text-charcoal/70">No reminders this week.</div>
          )}
          {sortedWeekDates.map((date) => (
            <div key={date}>
              <h3 className="font-display text-lg">{formatDateLabel(date)}</h3>
              <div className="mt-3 flex flex-col gap-3">
                {weekDays[date].map((reminder) => (
                  <ReminderRow key={reminder.id} reminder={reminder} queryKey={["schedule", "week", selectedDate]} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="mt-16 border-t border-charcoal/10 pt-10">
        <h2 className="font-display text-2xl">Your schedules</h2>
        <p className="mt-2 text-sm text-charcoal/70">Edit times and days, turn notifications on or off, pause, resume, or discontinue.</p>
        <div className="mt-6 flex flex-col gap-4">
          {(schedulesQuery.data?.schedules ?? []).length === 0 && (
            <p className="text-sm text-charcoal/70">No schedules yet.</p>
          )}
          {schedulesQuery.data?.schedules.map((schedule) => (
            <ScheduleCard key={schedule.id} schedule={schedule} />
          ))}
        </div>
      </section>

      <section className="mt-16 border-t border-charcoal/10 pt-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl">Add a medicine yourself</h2>
            <p className="mt-2 text-sm text-charcoal/70">No prescription photo needed — type it in and set your own reminder times.</p>
          </div>
          {!addingMedicine && (
            <Button variant="secondary" onClick={() => setAddingMedicine(true)}>
              Add a medicine
            </Button>
          )}
        </div>
        {addingMedicine && (
          <div className="mt-6">
            <AddMedicineForm
              onCancel={() => setAddingMedicine(false)}
              onAdded={(medication) => {
                setAddingMedicine(false);
                setSchedulingMedicationId(medication.id);
              }}
            />
          </div>
        )}
      </section>

      {confirmedWithoutSchedule.length > 0 && (
        <section className="mt-16 border-t border-charcoal/10 pt-10">
          <h2 className="font-display text-2xl">Set up reminders for a confirmed medication</h2>
          <p className="mt-2 text-sm text-charcoal/70">
            Only confirmed instructions can be turned into a schedule. Scriptly prepares one from those instructions —
            showing which times were written and which are only suggestions — and nothing is saved until you review it.
          </p>
          <div className="mt-6 flex flex-col gap-4">
            {confirmedWithoutSchedule.map((medication) =>
              schedulingMedicationId === medication.id ? (
                <CreateScheduleForm key={medication.id} medication={medication} onDone={() => setSchedulingMedicationId(null)} />
              ) : (
                <div key={medication.id} className="flex items-center justify-between rounded-2xl border border-charcoal/10 p-5">
                  <span>{medication.confirmedName ?? medication.extractedName}</span>
                  <Button variant="secondary" onClick={() => setSchedulingMedicationId(medication.id)}>
                    Set up reminders
                  </Button>
                </div>
              )
            )}
          </div>
        </section>
      )}
    </div>
  );
}
