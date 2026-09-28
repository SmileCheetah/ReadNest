import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "readnest.accessToken";
let webSessionToken: string | null = null;

// Web previews have an in-memory session only; never persist bearer tokens in localStorage.
export const tokenStorage = {
  get: () =>
    Platform.OS === "web"
      ? Promise.resolve(webSessionToken)
      : SecureStore.getItemAsync(TOKEN_KEY),
  set: async (token: string) => {
    if (Platform.OS === "web") webSessionToken = token;
    else await SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  clear: async () => {
    if (Platform.OS === "web") webSessionToken = null;
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
};
