import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const GUEST_IDENTITY_KEY = "readnest.developmentGuestIdentity";
let webFallbackIdentity: string | null = null;

function getWebIdentity() {
  try {
    return globalThis.sessionStorage?.getItem(GUEST_IDENTITY_KEY) ?? null;
  } catch {
    return webFallbackIdentity;
  }
}

function setWebIdentity(identity: string) {
  webFallbackIdentity = identity;
  try {
    globalThis.sessionStorage?.setItem(GUEST_IDENTITY_KEY, identity);
  } catch {
    // Sandboxed previews can deny storage. The in-memory fallback still keeps
    // the current preview session stable without persisting a credential.
  }
}

export const guestIdentityStorage = {
  getOrCreate: async () => {
    const existing =
      Platform.OS === "web"
        ? getWebIdentity()
        : await SecureStore.getItemAsync(GUEST_IDENTITY_KEY);
    if (existing) return existing;

    const identity = Crypto.randomUUID();
    if (Platform.OS === "web") setWebIdentity(identity);
    else await SecureStore.setItemAsync(GUEST_IDENTITY_KEY, identity);
    return identity;
  },
};
