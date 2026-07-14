// Tappable date field backed by the platform-native date picker.
//
// Replaces the free-typed "YYYY-MM-DD" TextInputs. Value is a YYYY-MM-DD
// string (matching the Postgres `date` columns) or null when cleared.
//
// Platform behavior:
//   Android — opens the Material date dialog imperatively.
//   iOS     — opens a modal with the inline calendar; committed via Done so
//             spinning through years doesn't close it prematurely.
//   Web     — falls back to a validated text input (the native picker has
//             no web implementation).
//
// Serialization gotcha: the picker returns a JS Date in *local* time.
// Building the string from toISOString() would shift the calendar day for
// negative-offset timezones (all of the US), so we use local date parts.

import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import { CalendarDays, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Platform, Pressable, TextInput, View } from "react-native";

import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { colors, fonts } from "@/lib/theme";

import { Button } from "./Button";
import { Text } from "./Text";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local-date parts → "YYYY-MM-DD". */
function toIsoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" → local Date (today when null/invalid). */
function fromIsoDay(s: string | null): Date {
  if (s && ISO_DATE_RE.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

export type DateFieldProps = {
  /** YYYY-MM-DD, or null for "not set". */
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Show an ✕ that resets the value to null. */
  clearable?: boolean;
  maximumDate?: Date;
  minimumDate?: Date;
  /** Extra classes for the field container (e.g. "mb-4"). */
  className?: string;
  accessibilityLabel?: string;
};

export function DateField({
  value,
  onChange,
  placeholder = "Select a date",
  clearable = false,
  maximumDate,
  minimumDate,
  className,
  accessibilityLabel,
}: DateFieldProps) {
  const [iosOpen, setIosOpen] = useState(false);
  // iOS commits on Done; hold the in-progress selection here meanwhile.
  const [iosDraft, setIosDraft] = useState<Date>(() => fromIsoDay(value));
  // Web fallback keeps its own text so partial input doesn't reach onChange.
  const [webText, setWebText] = useState(value ?? "");

  if (Platform.OS === "web") {
    return (
      <TextInput
        className={cn(
          "bg-surface border border-border rounded-xl px-4 py-3 text-text",
          className,
        )}
        style={{ fontFamily: fonts.regular, fontSize: 16 }}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textSubtle}
        value={webText}
        onChangeText={(t) => {
          setWebText(t);
          const trimmed = t.trim();
          if (!trimmed) onChange(null);
          else if (ISO_DATE_RE.test(trimmed) && !Number.isNaN(new Date(trimmed).getTime()))
            onChange(trimmed);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  function openPicker() {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: fromIsoDay(value),
        mode: "date",
        maximumDate,
        minimumDate,
        onChange: (event, date) => {
          if (event.type === "set" && date) onChange(toIsoDay(date));
        },
      });
    } else {
      setIosDraft(fromIsoDay(value));
      setIosOpen(true);
    }
  }

  return (
    <>
      <Pressable
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? "Select date"}
        className={cn(
          "flex-row items-center bg-surface border border-border rounded-xl px-4 py-3 active:bg-surface-muted",
          className,
        )}
      >
        <CalendarDays size={16} color={colors.textMuted} />
        <Text
          variant="body"
          className={cn("flex-1 ml-2.5", value ? "text-text" : "text-text-subtle")}
        >
          {value ? fmtDate(value) : placeholder}
        </Text>
        {clearable && value != null && (
          <Pressable
            onPress={() => onChange(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear date"
          >
            <X size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </Pressable>

      {Platform.OS === "ios" && (
        <Modal
          visible={iosOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIosOpen(false)}
        >
          <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
            <View className="bg-surface rounded-2xl p-4 w-full max-w-md">
              <DateTimePicker
                value={iosDraft}
                mode="date"
                display="inline"
                maximumDate={maximumDate}
                minimumDate={minimumDate}
                accentColor={colors.primaryStrong}
                // The app is light-only but the native picker follows the
                // SYSTEM appearance — in device dark mode it paints white
                // text onto our white card, making the calendar invisible.
                themeVariant="light"
                onChange={(_event, date) => {
                  if (date) setIosDraft(date);
                }}
              />
              <View className="flex-row gap-3 mt-2">
                <Button
                  variant="ghost"
                  label="Cancel"
                  className="flex-1 bg-surface-muted"
                  onPress={() => setIosOpen(false)}
                />
                <Button
                  variant="primary"
                  label="Done"
                  className="flex-1"
                  onPress={() => {
                    onChange(toIsoDay(iosDraft));
                    setIosOpen(false);
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}
