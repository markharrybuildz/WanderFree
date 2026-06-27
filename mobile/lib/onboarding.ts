// Per-user, per-device onboarding flag.
//
// Absent => the user has just signed in for the first time on this device
// and should be routed to the Cards tab with the welcome popup.
// Set => the user has either dismissed the popup or added their first card.
//
// The key includes user.id so that a delete-and-resignup test cycle (new
// auth user id) re-triggers onboarding without any extra cleanup.

import AsyncStorage from "@react-native-async-storage/async-storage";

const key = (userId: string) => `wanderfree-onboarded-${userId}`;

export async function isOnboarded(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(key(userId))) === "true";
}

export async function markOnboarded(userId: string): Promise<void> {
  await AsyncStorage.setItem(key(userId), "true");
}
