# AWS RDS trust bundle

`aws-rds-global-bundle.pem` is the unmodified public CA bundle downloaded from
https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem on 2026-10-21.

SHA-256: `90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b`

Source and certificate rotation guidance:
https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html

The bundle is embedded in the executable so TLS connections do not depend on
a runtime download or the working directory. It contains public certificates,
not database credentials or private keys. It applies only to TLS-enabled RDS
endpoints in commercial AWS regions (`*.rds.amazonaws.com`). Other hosts use
SQLx's default trust roots. Hostname and chain verification remain mandatory.
China and GovCloud endpoints require their own bundles and are not covered.

To update, download the official bundle over HTTPS, inspect its certificates,
update the date/hash here, rebuild, and run the opt-in read-only native test:

```sh
node scripts/rds-tls-smoke.mjs /path/to/.env SQL_URL_MASTER
```

The test passes credentials to Cargo's test process through stdin, exercises
both MySQL and MariaDB profiles via the app's connection/session code, executes
`SELECT 1`, and checks that a TLS cipher was negotiated. It never changes data.
