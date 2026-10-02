import { expect, type Page } from "@playwright/test";

export const PASSWORD = "demo-cir-2026!";

export async function login(page: Page, email: string) {
  await page.goto("/connexion");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByRole("heading", { name: /Exercice/ })).toBeVisible();
}
