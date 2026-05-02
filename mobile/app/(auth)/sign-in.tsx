// Email/password sign-in + sign-up combined screen.
//
// Supabase Auth requires email confirmation by default. After sign-up we
// show a "check your email" alert and bounce back to sign-in mode rather
// than leaving the user in limbo.

import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { signInWithEmail, signUpWithEmail } from "@/lib/auth";

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
    const { error } = await fn(email.trim(), password);
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
    // here makes the transition feel snappy.
    router.replace("/(app)/benefits");
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-gray-900 mb-2">WanderFree</Text>
        <Text className="text-base text-gray-600 mb-8">
          {mode === "sign-in" ? "Sign in to your account" : "Create an account"}
        </Text>

        <TextInput
          className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-3 text-gray-900"
          placeholder="Email"
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-6 text-gray-900"
          placeholder="Password"
          placeholderTextColor="#9ca3af"
          secureTextEntry
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          value={password}
          onChangeText={setPassword}
        />

        <Pressable
          onPress={handleSubmit}
          disabled={loading || !email || !password}
          className={`rounded-xl py-3 items-center ${
            loading || !email || !password ? "bg-gray-300" : "bg-blue-600"
          }`}
        >
          <Text className="text-white font-semibold text-base">
            {loading ? "..." : mode === "sign-in" ? "Sign in" : "Sign up"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMode((m) => (m === "sign-in" ? "sign-up" : "sign-in"))}
          className="mt-4 items-center"
        >
          <Text className="text-blue-600 text-sm">
            {mode === "sign-in"
              ? "Need an account? Sign up"
              : "Already have an account? Sign in"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
