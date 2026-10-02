-- Rôles PostgreSQL (exécuté une fois à la création du conteneur de développement).
-- cir_owner : propriétaire du schéma, utilisé uniquement pour les migrations.
-- cir_app   : rôle applicatif SANS BYPASSRLS ; toutes les requêtes de l'API passent par lui.
CREATE ROLE cir_app LOGIN PASSWORD 'cir_app' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE cir_test OWNER cir_owner;
