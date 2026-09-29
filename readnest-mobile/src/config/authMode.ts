declare const __DEV__: boolean;

const configuredGuestMode = process.env.EXPO_PUBLIC_GUEST_MODE;

// Guest mode is intentionally limited to development builds. Release builds keep
// the existing login and signup flow even if an environment value is injected.
export const guestModeEnabled =
  __DEV__ && configuredGuestMode?.toLowerCase() !== "false";
