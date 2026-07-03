import { describe, it, expect } from "vitest";
import {
  isContactRecipient,
  CONTACT_ADDRESS,
  CONTACT_RECIPIENTS,
  CONTACT_FROM,
} from "@/lib/inbound/contact-forward";

describe("contact-forward recipient matching", () => {
  it("matches a bare contact address", () => {
    expect(isContactRecipient(["contact@imagevault.ai"])).toBe(true);
  });

  it("matches a name-wrapped contact address", () => {
    expect(isContactRecipient(["Image Vault <Contact@ImageVault.ai>"])).toBe(true);
  });

  it("matches when the contact address is among several recipients", () => {
    expect(
      isContactRecipient(["someone@else.com", "contact@imagevault.ai"])
    ).toBe(true);
  });

  it("does not match unrelated recipients", () => {
    expect(isContactRecipient(["alias@changling.io", "hi@imagevault.ai"])).toBe(false);
  });

  it("does not match an empty recipient list", () => {
    expect(isContactRecipient([])).toBe(false);
  });

  it("forwards to both team inboxes", () => {
    expect(CONTACT_ADDRESS).toBe("contact@imagevault.ai");
    expect(CONTACT_RECIPIENTS).toContain("lukefieldsend@googlemail.com");
    expect(CONTACT_RECIPIENTS).toContain("Martin.davison@gmail.com");
  });

  it("sends from a verified imagevault.ai domain (not changling.io)", () => {
    expect(CONTACT_FROM).toContain("@imagevault.ai");
    expect(CONTACT_FROM).not.toContain("changling.io");
  });
});
