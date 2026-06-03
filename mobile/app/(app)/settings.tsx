// Settings — account info, portfolio switcher, sign out.

import { router } from "expo-router";
import { Check, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { signOut, useAuthSession } from "@/lib/auth";
import {
  useCreatePortfolio,
  useCurrentPortfolio,
  useDeletePortfolio,
  useSetCurrentPortfolio,
  useUserPortfolios,
} from "@/lib/hooks";
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
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <View className="bg-white border-b border-gray-200 px-4 py-4">
        <Text className="text-2xl font-bold text-gray-900">Settings</Text>
      </View>

      <View className="p-4">
        <View className="bg-white rounded-xl p-4 mb-4 border border-gray-200">
          <Text className="text-xs text-gray-500 uppercase tracking-wide">
            Signed in as
          </Text>
          <Text className="text-base text-gray-900 mt-1">
            {session?.user.email}
          </Text>
        </View>

        <Text className="text-xs text-gray-500 uppercase tracking-wide px-2 mb-2 mt-2">
          Portfolio
        </Text>
        <View className="bg-white rounded-xl border border-gray-200 mb-4 overflow-hidden">
          {(portfolios ?? []).map((p, idx) => {
            const isCurrent = p.id === currentPortfolio?.id;
            const canDelete = !!session && p.created_by === session.user.id;
            return (
              <View
                key={p.id}
                className={`flex-row items-center px-4 py-3 ${
                  idx > 0 ? "border-t border-gray-100" : ""
                }`}
              >
                <Pressable
                  onPress={() => handleSwitch(p)}
                  className="flex-1 flex-row items-center justify-between"
                >
                  <Text
                    className={`text-base ${
                      isCurrent ? "text-gray-900 font-medium" : "text-gray-800"
                    }`}
                  >
                    {p.name}
                  </Text>
                  {isCurrent && <Check size={18} color="#2563eb" />}
                </Pressable>
                {canDelete && (
                  <Pressable
                    onPress={() => handleDelete(p)}
                    className="ml-3 p-1"
                    hitSlop={8}
                  >
                    <Trash2 size={18} color="#dc2626" />
                  </Pressable>
                )}
              </View>
            );
          })}
          <Pressable
            onPress={() => setCreating(true)}
            className="flex-row items-center gap-2 px-4 py-3 border-t border-gray-100"
          >
            <Plus size={18} color="#2563eb" />
            <Text className="text-blue-600 font-medium">
              Create new portfolio
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handleSignOut}
          className="bg-white rounded-xl p-4 border border-gray-200"
        >
          <Text className="text-red-600 font-medium">Sign out</Text>
        </Pressable>
      </View>

      <Modal
        visible={creating}
        transparent
        animationType="fade"
        onRequestClose={() => setCreating(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="bg-white rounded-2xl p-5 w-full max-w-md">
            <Text className="text-lg font-semibold text-gray-900 mb-4">
              New portfolio
            </Text>
            <TextInput
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 text-gray-900"
              placeholder="Name (e.g. Household, Business)"
              placeholderTextColor="#9ca3af"
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="flex-1 py-3 rounded-xl bg-gray-100 items-center"
              >
                <Text className="text-gray-700 font-medium">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleCreate}
                disabled={!newName.trim() || create.isPending}
                className={`flex-1 py-3 rounded-xl items-center ${
                  !newName.trim() || create.isPending
                    ? "bg-gray-300"
                    : "bg-blue-600"
                }`}
              >
                <Text className="text-white font-medium">
                  {create.isPending ? "Creating..." : "Create"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
