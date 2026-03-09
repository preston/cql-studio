# CQL Studio Tutorial Transcript

This transcript is intended for voiceover with screen recordings. It walks through the major functional areas of CQL Studio as distinct chapters.

---

# Introduction

CQL Studio is an integrated suite for developing, testing, and publishing standards-based FHIR and CQL artifacts. You can author and edit CQL libraries, test them against your own FHIR data, run official engine compatibility tests, browse and validate terminology, and more.

CQL Studio can be deployed in many ways: locally, in a shared team environment, or as a public or cloud-hosted instance. These tutorials focus on a typical local deployment, but the same areas and workflows apply in other environments. Also note that certain areas are optional, such as AI integration features, and won't be visible unless configured.

We'll be using the official everygreen distribution published to HL7 Foundry, which is targetted to local CQL users wanting to run CQL Studio on your local laptop, and is tested to deploy out-of-the-box via Docker. If you don't have Docker Desktop installed, do that now. The evergreen distribution always uses the latest releases of all components, so expect things to change.

https://foundry.hl7.org/products/fb509f14-5bc1-491b-a145-fab078a901c0

The application is organized around the top navigation bar. Under **Testing** you’ll find tools related to CQL engine development and testing. Under **Authoring** you have the Terminology Browser and the CQL IDE. And under **Tools** you’ll find the FHIR Uploader and other common utilities. **Settings** is where you configure your FHIR server and terminology service URLs; many features depend on these being set correctly.

We’ll go through each major area in turn.

---

# Settings

Global settings control how CQL Studio talks to your FHIR server and terminology service. You set the FHIR base URL for data and libraries, and the terminology server info for value set and code lookups. These values are stored in your browser (localStorage) and persist across sessions local to your browser.

---


# Engine Test Runner

The Test Runner runs the official CQL engine compatibility test suite against a test runner API, so engine and tooling developers can verify their implementation against the same tests. Test Results (under Testing) is where you open or view saved result files from past runs.

Open the Test Runner from the top menu: **Testing** then **Test Runner**. This screen lets you run the official CQL engine compatibility test suite against a test runner API.

At the top you have a few controls: switch between **Form Editor** and **JSON Editor** to edit the run configuration, **Reset** to restore defaults, and **Recheck Tests Runner Health** to verify the runner API is reachable. If the API is unavailable, the main **Run Tests** button will be disabled and show “API Unavailable.”

The configuration is split into cards. **FHIR Server Configuration** defines the Base URL of the FHIR server used by the tests, the CQL operation—typically dollar-sign “cql”—and optionally an Original Base URL. **CQL Configuration** covers the CQL file version, CQL version for test filtering, a test run description, and optional translator and engine names and versions. There’s also a **Quick Test** option to run only smoke tests. A **Tests** section can define a results path and a skip list for excluding specific tests.

You can edit everything in the form, or switch to the **JSON Editor** to paste or load a full configuration from a JSON file. Use **Validate** to check the JSON, **Load from JSON** to load a file, and **Update from Form** to sync the JSON with the current form values.

When you’re ready, click **Run Tests**. A job is created and the page polls for status. You’ll see a warning to stay on the page while tests are queued and running. The **Job Status** card shows job ID, created time, elapsed time, and status—pending, in progress, completed, or failed. When the job completes successfully, you can **Download Results JSON** or **View Results** to open the results viewer. If the job fails, the error message is shown in the status area.

---

# CQL IDE

The CQL IDE is the main place to author and edit CQL libraries: open libraries from your FHIR server, create new ones, edit CQL with syntax highlighting and diagnostics, translate to ELM, save back to the server, and execute against your configured FHIR data. You can also use the AI and Clipboard panels to assist authoring.

Open the CQL IDE from **Authoring** then **CQL IDE**. This is the main authoring environment for CQL libraries.

When no library is open, the center area shows a welcome message and a **Keyboard Shortcuts** card. You can open a library from the FHIR server or create a new one from the left panel.

The layout has **editor tabs** across the top. Each tab is a CQL library; you can drag tabs to reorder them and drag files onto the tab bar to open new libraries. The active tab’s library is shown in the **CQL editor** below. The editor has syntax highlighting, bracket matching, and inline diagnostics. The toolbar above the editor includes **Reload** to refresh from the server, **Format** to format CQL, **Save** to persist changes to the FHIR server, and **Execute** to run the library against the configured FHIR server. There’s also a **Send terminology routing** checkbox that controls whether terminology requests are sent to the configured terminology service during execution. If the library is read-only, the Save button is replaced by a read-only badge.

**Left panel** tabs typically include **Navigation**—to open or create libraries—and **Outline**—a structural view of the current library. **Right panel** tabs include **FHIR**—metadata and server actions for the current library—**ELM**—translate CQL to ELM and view or copy the XML—**AI**—for AI-assisted editing and suggestions—and **Clipboard**—to paste ValueSets, CodeSystems, or Codings from the app clipboard into your workflow. **Bottom panel** tabs include **Problems** and **Console** (output). Console shows execution progress and results when you run a library. You can drag panel tabs between the left, right, and bottom panels to rearrange the layout.

To run the current library, save if needed then click **Execute**. Execution progress and results appear in the Console tab. Use the keyboard shortcuts listed on the welcome screen for format, clear, and other actions.

---

# Terminology Browser

The Terminology Browser lets you search and inspect value sets, concept maps, and code systems on your configured FHIR terminology server, validate codes, and expand value sets to see member codes. It isn't intended to be a full terminology authoring management environment, but more of a quick way to locate value sets or codings and add them to the app clipboard for use in the CQL IDE or and elsewhere in the application.

Open the Terminology Browser from **Authoring** then **Terminology Browser**. This section requires a configured terminology server in Settings. If the server is unavailable, an alert is shown with a link to Settings.

The browser has several tabs: **Value Sets**, **Concept Maps**, **Code Systems**, **Code Validation**, and **Code Search**.

**Value Sets**: Search by name, then browse results. You can change page size and use “next” and “previous” for pagination. Select a value set to see its details in a side or detail pane. From there you can expand to see included codes and add value sets or codings to the app clipboard for use in the CQL IDE or elsewhere.

**Concept Maps** and **Code Systems**: These tabs let you search and browse concept maps and code systems from the terminology server in a similar way—search, select, view details, and optionally add resources to the clipboard.

**Code Validation**: Enter a **Code** and select or search for a **Code System** and optionally a **ValueSet** URL. Click the validate button to check whether the code is valid in the given system or value set. Results indicate valid or invalid and any message from the server.

**Code Search**: Pick or enter a **ValueSet** URL—with search-as-you-type support—then optionally set a filter, count, offset, and options like “Include designations” and “Active only.” Run the search to expand the value set and see the list of codes. You can expand rows for more detail and add codings to the clipboard. This is useful for finding codes to use in CQL or measure definitions.

Across the terminology browser, the clipboard is a shared workspace: items you add here can be used in the CQL IDE’s Clipboard tab, in the standalone Clipboard Manager under Tools, and by AI tools when authoring CQL.

---

## 4. FHIR Uploader

The FHIR Uploader sends FHIR JSON bundles and CQL files to your configured FHIR server—for example to load sample data, load CQL libraries as FHIR Library resources, or reset and repopulate a development server.

Open the FHIR Uploader from **Tools** then **FHIR Uploader**. This tool uploads FHIR JSON bundles and CQL files to the FHIR server configured in Settings.

At the top you see the **FHIR Base URL** in use—read-only—with a link to **Application Settings** to change it. The **Continue on Error** switch controls whether upload continues to the next file when one fails.

There are two **drop zones**. The first is for **FHIR JSON files**: drag and drop or click “Choose JSON Files” to add transaction bundles or other FHIR JSON. The second is for **CQL files**: add one or more CQL files to be converted to FHIR Library resources and uploaded. You can add multiple files to each list.

The **Selected Files** list shows all added files with checkboxes to enable or disable each for upload. Use **Toggle All** to enable or disable everything, and **Clear All** to remove all files. For JSON bundles there may be a **Reorder Synthea Dependencies** button to fix dependency order for Synthea-style bundles. Each file row has move up, move down, and remove buttons. Drag the grip handle to reorder. After an upload, each file shows success or failure; you can expand successful ones to see the server response.

Click **Upload Bundles** to start the upload. A progress bar shows completion. JSON bundles are sent first, then CQL files as Library resources. If **Continue on Error** is off, the process stops at the first failure. When done, review the per-file status and expand any result to inspect the server response.

In developer mode, a **Danger Zone** section at the bottom offers **Reset Server** with options such as **Expunge** (for HAPI) or **Purge All** (for WildFHIR) to remove all resources from the server. These actions are irreversible and are only shown when developer settings are enabled.
