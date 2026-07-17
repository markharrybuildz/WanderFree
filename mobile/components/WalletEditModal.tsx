// Manual balance editing for a program wallet, shared by the Points tab and
// the card-details Rewards section.
//
// Three modes because that's how people actually know their points:
//   * "Set total" — you just checked the issuer portal and know the number.
//   * "Add"       — a statement told you what you earned this month.
//   * "Subtract"  — you redeemed some (a dedicated mode because the numeric
//                   keypads don't reliably offer a minus key).
// A live preview shows the resulting balance before saving.

import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { notify } from "@/lib/dialog";
import { formatProgramAmount, programUnitLabel } from "@/lib/format";
import { colors, fonts } from "@/lib/theme";
import type { ProgramUnitType } from "@/lib/types";

type Mode = "set" | "add" | "subtract";

export function WalletEditModal({
  open,
  programName,
  unitType,
  currentBalance,
  saving,
  onSave,
  onClose,
}: {
  open: boolean;
  programName: string;
  unitType: ProgramUnitType;
  currentBalance: number;
  saving?: boolean;
  onSave: (newBalance: number) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("set");
  const [amountText, setAmountText] = useState("");

  const parsed = (() => {
    const cleaned = amountText.replace(/[$,\s]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : null;
  })();

  const nextBalance =
    parsed == null
      ? null
      : mode === "set"
        ? parsed
        : mode === "add"
          ? currentBalance + parsed
          : Math.max(0, currentBalance - parsed);

  function handleSave() {
    if (nextBalance == null) {
      notify("Invalid amount", "Enter a number.");
      return;
    }
    onSave(nextBalance);
  }

  function reset(nextMode: Mode) {
    setMode(nextMode);
    setAmountText("");
  }

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 items-center justify-center bg-overlay/40 px-6"
      >
        <View className="bg-surface rounded-2xl p-5 w-full max-w-md">
          <Text variant="h2" className="mb-1">
            {programName}
          </Text>
          <Text variant="body" className="text-text-muted mb-4">
            Current balance: {formatProgramAmount(currentBalance, unitType)}
          </Text>

          <View className="flex-row bg-surface-muted rounded-full p-1 mb-4">
            {(
              [
                { key: "set", label: "Set total" },
                { key: "add", label: "Add" },
                { key: "subtract", label: "Subtract" },
              ] as { key: Mode; label: string }[]
            ).map((o) => {
              const active = o.key === mode;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => reset(o.key)}
                  className={cn(
                    "flex-1 items-center py-1.5 rounded-full",
                    active && "bg-primary-strong",
                  )}
                >
                  <Text
                    variant="callout"
                    className={active ? "text-white" : "text-text-muted"}
                  >
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text variant="label" className="text-text-subtle uppercase mb-2">
            {mode === "set"
              ? `New total (${programUnitLabel(unitType)})`
              : mode === "add"
                ? `Amount to add (${programUnitLabel(unitType)})`
                : `Amount to subtract (${programUnitLabel(unitType)})`}
          </Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 mb-2 text-text"
            style={{ fontFamily: fonts.regular, fontSize: 16 }}
            placeholder={unitType === "cash_back" ? "$210.55" : "60,000"}
            placeholderTextColor={colors.textSubtle}
            value={amountText}
            onChangeText={setAmountText}
            keyboardType={unitType === "cash_back" ? "decimal-pad" : "number-pad"}
            autoFocus
          />
          <Text variant="caption" className="text-text-muted mb-4">
            {nextBalance != null
              ? `New balance: ${formatProgramAmount(nextBalance, unitType)}`
              : " "}
          </Text>

          <View className="flex-row gap-3">
            <Button
              variant="ghost"
              label="Cancel"
              className="flex-1 bg-surface-muted"
              onPress={onClose}
            />
            <Button
              variant="primary"
              label="Save"
              className="flex-1"
              loading={saving}
              disabled={parsed == null}
              onPress={handleSave}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
