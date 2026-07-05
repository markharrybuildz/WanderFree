// Email/password sign-in + sign-up combined screen.
//
// Supabase Auth requires email confirmation by default. After sign-up we
// show a "check your email" alert and bounce back to sign-in mode rather
// than leaving the user in limbo.

import { router } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { signInWithEmail, signUpWithEmail } from "@/lib/auth";
import { isOnboarded } from "@/lib/onboarding";
import { colors, fonts } from "@/lib/theme";

type Mode = "sign-in" | "sign-up";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("sign-in");

  async function handleSubmit() {
    if (!email || !password) return;
    setLoading(true);
    const fn = mode === "sign-in" ? signInWithEmail : signUpWithEmail;
    const { data, error } = await fn(email.trim(), password);
    setLoading(false);

    if (error) {
      Alert.alert("Auth error", error.message);
      return;
    }

    if (mode === "sign-up") {
      Alert.alert(
        "Check your email",
        "We sent you a confirmation link. Click it, then come back and sign in.",
      );
      setMode("sign-in");
      return;
    }

    // The auth state listener in useAuthSession will update; the redirect
    // here makes the transition feel snappy. Route brand-new users to the
    // Cards tab so the welcome popup can guide them.
    const userId = data.session?.user.id ?? data.user?.id ?? null;
    const onboarded = userId ? await isOnboarded(userId) : true;
    router.replace(onboarded ? "/(app)/benefits" : "/(app)/cards");
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 justify-center px-6">
        <Image
          source={require("../../assets/logo-mark.png")}
          style={{ width: 88, height: 88 }}
          className="mb-2 -ml-2"
        />
        <Text variant="display" className="mb-2">WanderFree</Text>
        <Text variant="body" className="text-text-muted mb-8">
          {mode === "sign-in" ? "Sign in to your account" : "Create an account"}
        </Text>

        <TextInput
          className="bg-surface border border-border rounded-xl px-4 py-3 mb-3 text-text"
          style={{ fontFamily: fonts.regular, fontSize: 16 }}
          placeholder="Email"
          placeholderTextColor={colors.textSubtle}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          className="bg-surface border border-border rounded-xl px-4 py-3 mb-6 text-text"
          style={{ fontFamily: fonts.regular, fontSize: 16 }}
          placeholder="Password"
          placeholderTextColor={colors.textSubtle}
          secureTextEntry
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          value={password}
          onChangeText={setPassword}
        />

        <Button
          variant="primary"
          size="lg"
          fullWidth
          label={mode === "sign-in" ? "Sign in" : "Sign up"}
          loading={loading}
          disabled={!email || !password}
          onPress={handleSubmit}
        />

        <Pressable
          onPress={() => setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"))}
          className="mt-4 items-center"
        >
          <Text variant="callout" className="text-primary-strong">
            {mode === "sign-in"
              ? "Need an account? Sign up"
              : "Already have an account? Sign in"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
