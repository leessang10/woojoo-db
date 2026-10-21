# Remembered database passwords

On Windows, **Remember password on this PC** stores an authenticated password
in Windows Credential Manager (`CRED_TYPE_GENERIC`, `CRED_PERSIST_LOCAL_MACHINE`).
Windows protects it for the current Windows user on this machine. This is not
a separate application master password or a Windows Hello prompt on every use.

The app stores one credential at `Woojoo/Database/<profile-id>`. The credential
includes the engine, host, port, database, username, and TLS setting. The native
backend checks all of these before reusing the password, including rejecting
reuse after TLS is disabled. It never returns a stored password to the WebView.
Only credential availability and the user's remember preference reach the UI.
Profile files, localStorage, and workspace serialization exclude the password.

Passwords are saved only after a successful database connection and session
initialization. Without persistent saving, the native process remembers them
until exit. Unchecking the option and successfully reconnecting removes the
persistent entry while keeping the password in memory for that process.
**Delete saved password** clears both stores immediately; deleting a profile
also deletes its credential. Deletion does not terminate an existing DB session.
An in-flight connection cannot recreate a credential deleted during its attempt.

On startup, only the last selected profile with the remember preference enabled
is automatically connected. Missing credentials or authentication failure open
the connection dialog for re-entry, without an automatic retry loop. Other OSes
retain process-only memory and do not offer persistent password saving.

## Verification

The normal Rust tests use temporary, synthetic Windows credentials and remove
them afterwards. Frontend tests cover opt-in, secret-free profile serialization,
automatic connection, failure recovery, target changes, and credential deletion.

An opt-in test with authorized MySQL/MariaDB credentials can exercise the native
connection path and a fresh backend state:

```sh
node scripts/rds-tls-smoke.mjs /path/to/.env SQL_URL_MASTER remembered_password_survives_new_state
```

After building the app, verify a full process restart and deletion through the UI:

```sh
node scripts/credentials-restart-smoke.mjs /path/to/.env
```

This uses an isolated WebView profile and a unique credential, verifies TLS,
restarts the app without re-entering the password, runs `SELECT 1`, checks that
localStorage contains no password, then deletes the test credential and confirms
that another restart stays disconnected. It does not modify database data.
