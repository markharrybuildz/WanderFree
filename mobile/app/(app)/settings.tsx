// Settings — account info, portfolio switcher, sign out.

import { router } from "expo-router";
import { Check, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { signOut, useAuthSession } from "@/lib/auth";
import { cn } from "@/lib/cn";
import {
  useCreatePortfolio,
  useCurrentPortfolio,
  useDeletePortfolio,
  useSetCurrentPortfolio,
  useUserPortfolios,
} from "@/lib/hooks";
import { colors, fonts } from "@/lib/theme";
import type { Portfolio } from "@/lib/types";

export default function SettingsScreen() {
  const { session } = useAuthSession();
  const { data: portfolios } = useUserPortfolios();
  const { data: currentPortfolio } = useCurrentPortfolio();
  const setCurrent = useSetCurrentPortfolio();
  const create = useCreatePortfolio();
  const deletePortfolio = useDeletePortfolio();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function handleSignOut() {
    const { error } = await signOut();
    if (error) {
      Alert.alert("Sign out failed", error.message);
      return;
    }
    router.replace("/(auth)/sign-in");
  }

  function handleSwitch(p: Portfolio) {
    if (p.id === currentPortfolio?.id) return;
    setCurrent.mutate(p);
  }

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    create.mutate(trimmed, {
      onSuccess: () => {
        setCreating(false);
        setNewName("");
      },
      onError: (e) =>
        Alert.alert("Could not create portfolio", (e as Error).message),
    });
  }

  function handleDelete(p: Portfolio) {
    Alert.alert(
      `Delete "${p.name}"?`,
      "All cards, benefit cycles, redemptions, spend entries, and wallet balances in this portfolio will be permanently deleted. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            deletePortfolio.mutate(p.id, {
              onError: (e) =>
                Alert.alert("Delete failed", (e as Error).message),
            }),
        },
      ],
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 py-4">
        <Text variant="display">Settings</Text>
      </View>

      <View className="p-4">
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text variant="label" className="text-text-subtle uppercase">
            Signed in as
          </Text>
          <Text variant="body" className="mt-1">
            {session?.user.email}
          </Text>
        </View>

        <Text variant="label" className="text-text-subtle uppercase px-2 mb-2 mt-2">
          Portfolio
        </Text>
        <View className="bg-surface rounded-xl border border-border mb-4 overflow-hidden">
          {(portfolios ?? []).map((p, idx) => {
            const isCurrent = p.id === currentPortfolio?.id;
            const canDelete = !!session && p.created_by === session.user.id;
            return (
              <View
                key={p.id}
                className={cn(
                  "flex-row items-center px-4 py-3",
                  idx > 0 && "border-t border-border",
                )}
              >
                <Pressable
                  onPress={() => handleSwitch(p)}
                  className="flex-1 flex-row items-center justify-between"
                >
                  <Text variant={isCurrent ? "title" : "body"}>{p.name}</Text>
                  {isCurrent && <Check size={18} color={colors.primaryStrong} />}
                </Pressable>
                {canDelete && (
                  <Pressable
                    onPress={() => handleDelete(p)}
                    className="ml-3 p-1"
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete portfolio ${p.name}`}
                  >
                    <Trash2 size={18} color={colors.error} />
                  </Pressable>
                )}
              </View>
            );
          })}
          <Pressable
            onPress={() => setCreating(true)}
            className="flex-row items-center gap-2 px-4 py-3 border-t border-border"
          >
            <Plus size={18} color={colors.primaryStrong} />
            <Text variant="callout" className="text-primary-strong">
              Create new portfolio
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handleSignOut}
          className="bg-surface rounded-xl p-4 border border-border"
        >
          <Text variant="callout" className="text-error-text">Sign out</Text>
        </Pressable>
      </View>

      <Modal
        visible={creating}
        transparent
        animationType="fade"
        onRequestClose={() => setCreating(false)}
      >
        <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
          <View className="bg-surface rounded-2xl p-5 w-full max-w-md">
            <Text variant="h2" className="mb-4">New portfolio</Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="Name (e.g. Household, Business)"
              placeholderTextColor={colors.textSubtle}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View className="flex-row gap-3">
              <Button
                variant="ghost"
                label="Cancel"
                className="flex-1 bg-surface-muted"
                onPress={() => {
                  setCreating(false);
                  setNewName("");
                }}
              />
              <Button
                variant="primary"
                label="Create"
                className="flex-1"
                disabled={!newName.trim()}
                loading={create.isPending}
                onPress={handleCreate}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
