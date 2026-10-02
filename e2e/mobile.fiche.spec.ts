import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("un contributeur saisit sa fiche du jour sur mobile en moins de 2 minutes", async ({ page }) => {
  await login(page, "karim@demo-cir.fr");
  const start = Date.now();
  await page.getByRole("link", { name: "Saisir ma fiche du jour" }).click();
  await expect(page.getByRole("heading", { name: "Fiche du jour" })).toBeVisible();
  await page.getByLabel("Sujet de recherche").selectOption({ label: "S1.1 Normalisation apprise des désignations" });
  await page.getByLabel("Travaux menés").fill("Ajout de règles d'unités composées et réévaluation sur le jeu de test.");
  await page.getByText("Succès", { exact: true }).click();
  await page.getByRole("textbox", { name: "Résultat" }).fill("Exactitude portée à 78 % sur les unités composées.");
  await page.getByLabel("Heures").first().fill("3");
  await page.getByRole("button", { name: "Enregistrer la fiche du jour" }).click();
  await expect(page.getByRole("heading", { name: /Fiche du/ })).toBeVisible();
  await expect(page.getByText("Total : 3 h")).toBeVisible();
  expect(Date.now() - start).toBeLessThan(120_000);
});
