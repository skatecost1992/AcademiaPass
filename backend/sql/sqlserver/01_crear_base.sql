/*
  AcademiaPass - Crea la base de datos y el usuario de la aplicacion en SQL Server.
  Se ejecuta con crear-base-sqlserver.ps1 (sqlcmd), que pasa estas variables desde variables de entorno:
    $(DB_NAME)       nombre de la base (por defecto AcademiaPass)
    $(APP_LOGIN)     login que usara el backend (por defecto academiapass_app)
    $(APP_PASSWORD)  clave de ese login (variable de entorno ACADEMIAPASS_APP_PASSWORD)
  Es idempotente: si la base o el login ya existen, no los vuelve a crear.
*/
SET NOCOUNT ON;

IF DB_ID(N'$(DB_NAME)') IS NULL
BEGIN
  PRINT N'Creando base de datos $(DB_NAME)...';
  CREATE DATABASE [$(DB_NAME)] COLLATE Modern_Spanish_CI_AS;
END
ELSE
  PRINT N'La base $(DB_NAME) ya existe.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(APP_LOGIN)')
BEGIN
  PRINT N'Creando login $(APP_LOGIN)...';
  CREATE LOGIN [$(APP_LOGIN)] WITH PASSWORD = N'$(APP_PASSWORD)', DEFAULT_DATABASE = [$(DB_NAME)], CHECK_POLICY = ON;
END
ELSE
BEGIN
  PRINT N'El login $(APP_LOGIN) ya existe: se actualiza su clave.';
  ALTER LOGIN [$(APP_LOGIN)] WITH PASSWORD = N'$(APP_PASSWORD)';
END
GO

USE [$(DB_NAME)];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(APP_LOGIN)')
  CREATE USER [$(APP_LOGIN)] FOR LOGIN [$(APP_LOGIN)];
-- Lectura, escritura y creacion de tablas (el backend aplica el esquema al arrancar)
ALTER ROLE db_datareader ADD MEMBER [$(APP_LOGIN)];
ALTER ROLE db_datawriter ADD MEMBER [$(APP_LOGIN)];
ALTER ROLE db_ddladmin ADD MEMBER [$(APP_LOGIN)];
PRINT N'Usuario $(APP_LOGIN) listo en $(DB_NAME).';
GO
