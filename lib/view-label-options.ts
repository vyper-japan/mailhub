import { buildLabelGroups } from "@/lib/labels";

type ViewLabelOption = { value: string; label: string };

const VIEW_BASE_LABEL_OPTIONS: ViewLabelOption[] = [
  { value: "todo", label: "todo" },
  { value: "waiting", label: "waiting" },
  { value: "muted", label: "muted" },
  { value: "mine", label: "mine" },
  { value: "unassigned", label: "unassigned" },
  { value: "all", label: "all" },
];

export function buildViewChannelOptions(testMode: boolean): ViewLabelOption[] {
  const channels = buildLabelGroups(testMode).find((group) => group.id === "channels")?.items ?? [];
  return channels
    .filter((item) => item.type === "channel" && item.id !== "all")
    .map((item) => ({ value: item.id, label: item.id }));
}

export function buildViewLabelSelectOptions(testMode: boolean): { newView: ViewLabelOption[]; editView: ViewLabelOption[] } {
  const options = [...VIEW_BASE_LABEL_OPTIONS, ...buildViewChannelOptions(testMode)];
  return {
    newView: options.map((option) => ({ ...option })),
    editView: options.map((option) => ({ ...option })),
  };
}
