import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { guestIdentityStorage } from "./guestIdentityStorage";

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn() }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

describe("guestIdentityStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reuses the existing secure guest identity", async () => {
    jest
      .mocked(SecureStore.getItemAsync)
      .mockResolvedValue("7c857d5e-5083-40d9-a8d0-a641837a8849");

    await expect(guestIdentityStorage.getOrCreate()).resolves.toBe(
      "7c857d5e-5083-40d9-a8d0-a641837a8849",
    );
    expect(Crypto.randomUUID).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("creates and securely stores a random identity only when missing", async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    jest
      .mocked(Crypto.randomUUID)
      .mockReturnValue("d9bfc025-81a7-48ee-b13b-2910e356b865");

    await expect(guestIdentityStorage.getOrCreate()).resolves.toBe(
      "d9bfc025-81a7-48ee-b13b-2910e356b865",
    );
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "readnest.developmentGuestIdentity",
      "d9bfc025-81a7-48ee-b13b-2910e356b865",
    );
  });
});
