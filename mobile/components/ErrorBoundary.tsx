// Root error boundary. Catches render/lifecycle errors anywhere below it,
// logs them to the client_errors sink (via lib/errorLog), and shows a
// recover-able fallback instead of a blank white screen or a crash.
//
// This complements the global ErrorUtils handler (async/event-handler errors):
// React only routes *render-phase* errors to boundaries, so both are needed
// for full coverage.

import { Component, type ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { logError } from "@/lib/errorLog";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    logError(error, {
      source: "boundary",
      fatal: true,
      context: { componentStack: info?.componentStack?.slice(0, 4096) ?? null },
    });
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center px-8">
          <Text variant="h1" className="mb-2 text-center">
            Something went wrong
          </Text>
          <Text variant="body" className="mb-6 text-center text-text-muted">
            The app hit an unexpected error. Your data is safe. You can try again
            — if it keeps happening, restarting the app usually clears it.
          </Text>
          <Button label="Try again" onPress={this.reset} />
        </View>
      </SafeAreaView>
    );
  }
}
