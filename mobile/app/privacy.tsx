// Privacy & Beta notice.
//
// TEMPLATE — this is plain-language boilerplate describing what the app
// actually stores, NOT a finished legal document and NOT legal advice. Have
// it reviewed (or replace it with a policy from a reputable generator/lawyer)
// before any public launch, and fill in the [bracketed] placeholders.
//
// Linked from the sign-in screen's consent line and from Settings. Lives at
// the root so it's reachable before and after auth.

import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/ui/Text";
import { colors } from "@/lib/theme";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-5">
      <Text variant="h2" className="mb-1.5">
        {title}
      </Text>
      <Text variant="body" className="text-text-muted">
        {children}
      </Text>
    </View>
  );
}

export default function PrivacyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 py-4 flex-row items-center gap-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text variant="h2">Privacy &amp; Beta Notice</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View className="bg-warning-subtle rounded-xl p-3 mb-5">
          <Text variant="caption" className="text-warning">
            WanderFree is currently in beta. This notice is provided in plain
            language; your data and features may change or be reset during
            testing.
          </Text>
        </View>

        <Section title="What we store">
          Your account email (for sign-in), and the data you enter to track your
          rewards: the cards you add, your portfolios, benefit cycles and
          redemptions you mark, and any spending or wallet entries. This is kept
          in our database so the app works across launches and, if you choose,
          can be shared within a portfolio.
        </Section>

        <Section title="What we don't collect">
          We do not ask for or store full card numbers, security codes (CVV),
          bank login credentials, or government IDs.
        </Section>

        <Section title="How we use it">
          Only to run the app for you — showing your cards, benefits, and
          tracking. We don&apos;t sell your data or use it for advertising.
        </Section>

        <Section title="Where it lives">
          Data is stored with our backend provider (Supabase) and protected by
          per-user access rules so people can only read and write their own
          portfolios&apos; data.
        </Section>

        <Section title="Your choices">
          You can permanently delete your account and all associated data at any
          time from Settings → Delete account. You can also email us at
          [your-support-email] with any request.
        </Section>

        <Section title="Contact">
          [Your name / entity] · [your-support-email]{"\n"}
          Last updated: [date]
        </Section>

        <Text variant="caption" className="text-text-subtle mt-2">
          Template notice — to be reviewed and finalized before public release.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
