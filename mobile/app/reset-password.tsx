// Password reset — the landing screen for the recovery deep link.
//
// Flow: sign-in → "Forgot password?" → Supabase emails a link carrying a
// PKCE ?code=. Opening it launches wanderfree://reset-password?code=…,
// which routes here; we exchange the code for a recovery session, let the
// user set a new password, and drop them into the app (the exchange signs
// them in). Lives at the root, like privacy, so it's reachable pre-auth.
//
// Expired/used links fail the exchange — we show a clear message and a
// path back to sign-in rather than a dead end.

import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { notify } from "@/lib/dialog";
import { supabase } from "@/lib/supabase";
import { colors, fonts } from "@/lib/theme";

type Phase = "exchanging" | "ready" | "invalid";

export default function ResetPasswordScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [phase, setPhase] = useState<Phase>("exchanging");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!code) {
        if (mounted) setPhase("invalid");
        return;
      }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (mounted) setPhase(error ? "invalid" : "ready");
    })();
    return () => {
      mounted = false;
    };
  }, [code]);

  async function handleSave() {
    if (password.length < 8) {
      notify("Password too short", "Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      notify("Passwords don't match", "Re-enter the same password in both fields.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      notify("Could not update password", error.message);
      return;
    }
    // The recovery exchange already signed them in — straight to the app.
    router.replace("/home" as never);
  }

  if (phase === "exchanging") {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (phase === "invalid") {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 justify-center px-6">
          <Text variant="h1" className="mb-2">
            Reset link expired
          </Text>
          <Text variant="body" className="text-text-muted mb-8">
            This password reset link is invalid or has already been used.
            Request a new one from the sign-in screen.
          </Text>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            label="Back to sign in"
            onPress={() => router.replace("/(auth)/sign-in")}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 justify-center px-6">
        <Text variant="h1" className="mb-2">
          Set a new password
        </Text>
        <Text variant="body" className="text-text-muted mb-8">
          Choose a new password for your account.
        </Text>

        <TextInput
          className="bg-surface border border-border rounded-xl px-4 py-3 mb-3 text-text"
          style={{ fontFamily: fonts.regular, fontSize: 16 }}
          placeholder="New password"
          placeholderTextColor={colors.textSubtle}
          secureTextEntry
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          autoFocus
        />
        <TextInput
          className="bg-surface border border-border rounded-xl px-4 py-3 mb-6 text-text"
          style={{ fontFamily: fonts.regular, fontSize: 16 }}
          placeholder="Confirm new password"
          placeholderTextColor={colors.textSubtle}
          secureTextEntry
          autoComplete="new-password"
          value={confirm}
          onChangeText={setConfirm}
        />

        <Button
          variant="primary"
          size="lg"
          fullWidth
          label="Save new password"
          loading={saving}
          disabled={!password || !confirm}
          onPress={handleSave}
        />
      </View>
    </SafeAreaView>
  );
}
