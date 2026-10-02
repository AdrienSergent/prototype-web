import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("l'expert voit la référence postérieure au début des travaux et commente", async ({ page }) => {
  await login(page, "expert@cabinet-demo.fr");
  await page.getByRole("link", { name: "Rédaction" }).click();
  await page.getByRole("link", { name: /État de l'art/ }).click();
  await expect(page.getByText(/après le début des travaux/)).toBeVisible();
  await page.getByRole("tab", { name: /Commentaires/ }).click();
  await page.getByRole("textbox", { name: "Commentaire" }).fill("Merci de dater précisément la publication Navarro.");
  await page.getByRole("button", { name: "Commenter" }).click();
  await expect(page.getByText("Merci de dater précisément la publication Navarro.")).toBeVisible();
});

test("l'administrateur consulte la check-list et la vue consolidée", async ({ page }) => {
  await login(page, "ceo@demo-cir.fr");
  await page.getByRole("link", { name: "Check-list" }).click();
  await expect(page.getByRole("heading", { name: "Check-list de complétude" })).toBeVisible();
  await expect(page.getByText(/RAPPRO : « Abbreviation expansion/)).toBeVisible();
  await page.getByRole("link", { name: "Vue consolidée" }).click();
  const frame = page.frameLocator("iframe[title='Dossier consolidé']");
  await expect(frame.getByText("Dossier justificatif CIR")).toBeVisible();
  await expect(frame.getByText("Rapprochement automatique factures / commandes").first()).toBeVisible();
});

test("le rédacteur contrôle un import de temps en erreur sans rien importer", async ({ page }) => {
  await login(page, "cto@demo-cir.fr");
  await page.goto("/temps/import");
  const csv = "Personne;Code projet;Date;Heures\nInconnu;RAPPRO;07/2026;10\n";
  await page.locator("input[type=file]").setInputFiles({ name: "temps.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Contrôler les lignes" }).click();
  await expect(page.getByText("Personne inconnue : « Inconnu »")).toBeVisible();
  await expect(page.getByText(/rien ne sera importé/)).toBeVisible();
});
