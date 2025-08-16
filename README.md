# Automated Monthly Invoice Worker

This is a Cloudflare Worker written in JavaScript that automates the process of sending monthly invoices to clients. It is designed to be triggered on a schedule, generating personalized PDF invoices and sending them via email.

## How it works

The worker performs the following actions on a schedule (defaults to the 28th of every month):

1. **Reads Configuration**: It reads a `src/config.json` file to get a list of all clients that need to be invoiced.
2. **Gets Invoice Number**: It connects to a Cloudflare KV store to get the last used invoice number and calculates the next sequential numbers for the current run.
3. **Generates PDFs**: For each client, it generates a PDF invoice containing their specific details and the services for which you're charging them. You can define distinct payment methods per client.
4. **Sends Emails**: It sends each PDF as an email attachment to the recipients specified in the configuration file, using the MailPace API. A copy is also sent to the same email configured as `FROM_EMAIL` for visibility.
5. **Handles Failures**: If an invoice fails to be sent, the worker will store the generated PDF in a Cloudflare R2 bucket for manual review. This way, you don't lose that invoice and mess up your invoice numbers (if you care about that).

## Features

- **Automated Invoicing**: Runs automatically on a cron schedule.
- **Dynamic PDF Generation**: Creates unique PDF invoices for each client.
- **Multi-client Support**: Manages multiple clients with different details (including TO/CC email recipients and payment information) via a simple JSON configuration.
- **Sequential Invoice Numbers**: Uses a Cloudflare KV namespace to ensure invoice numbers are always sequential and never reused.
- **Robust Error Handling**: Saves PDFs of failed sends to a Cloudflare R2 bucket.
- **Privacy-Focused Email**: Uses [MailPace](https://mailpace.com/) for sending emails, an email provider that's serious about privacy.

## Setup Instructions

1. **Clone the repo**:
    ```bash
    git clone https://github.com/sanbotto/auto-invoice
    cd auto-invoice
    ```

2. **Install dependencies**:
    ```bash
    npm install
    ```

3. **Authenticate with Cloudflare**:
    - Go to the [API Tokens section](https://dash.cloudflare.com/profile/api-tokens) of the Cloudflare dashboard and create a new token using the **"Edit Cloudflare Workers"** template.
    - In your terminal, export the token as an environment variable:
      ```bash
      export CLOUDFLARE_API_TOKEN="<your-api-token>"
      ```
      _You should also add it to your `.env` (without the `export`)._

4. **Create Cloudflare Resources**:
    - Run the setup script to automatically create the required KV and R2 resources.
      ```bash
      bash setup.sh
      ```
    - After the script runs, it will output the details of the created resources. **You must copy the `id` of the KV namespace into your `wrangler.json` file.**

5. **Set Up Environment Variables**:
    - **For Local Testing**: Make sure to rename `example.env` to `.env` and update the values as required.
    - **For Deployment**: Rename `example-wrangler.json` to `wrangler.json` and update all the values in the form `${VAR}`. Also, rename `example.dev.vars` to `.dev.vars` and place your MailPace API token there so that Wrangler can create the corresponding secret (an encrypted env var, basically).

6. **Initialize Invoice Number**:
    - In your KV namespace, manually add the required key/value pair. Set the key to `LAST_INVOICE_NUMBER` and the value to the number that's right before your desired starting invoice number (e.g., set it to `1000` if you want the first invoice to be `1001`). I'm sure there might be a way to do this programmatically but I was too lazy to keep trying to figure it out, after all, it's just a one-time thing...

7. **Customize Client Details**:
    - Rename `src/example-config.json` to `src/config.json` and update it as required.

8. **Test**:
    - After all your customizations, it's convenient for you to check that your invoices look as expected. For this, you can run:
      ```bash
      npm run test-pdf
      ```
      This will generate your invoices locally so that you can check them out. If anything looks out of place, adjust as required before deploying.

9. **Deploy the Worker**:
    - Simply run:
      ```bash
      wrangler deploy
      ```

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

You may use, modify, and distribute this software under the terms of the AGPL-3.0. See the LICENSE file for details.

**TL;DR:** The AGPL-3.0 ensures that all changes and derivative works must also be licensed under AGPL-3.0, and that **attribution is preserved**. If you run a modified version as a network service, you must make the source code available to users. The code is provided **as-is**, without warranties.
