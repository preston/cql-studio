# CQL Studio Tutorial Transcript

This transcript is intended for voiceover with screen recordings. It walks through the major functional areas of CQL Studio as distinct chapters.

---

# Introduction

Hi and welcome this CQL Studio Quickstart Tutorial that will get you up and running CQL Studio on your local computer using the prebuilt official distribution. The website is simply https://cqlstudio.com where you'll find more info and GitHub links to the source code for contributions.

CQL Studio is an integrated suite for developing, testing, and publishing standards-based FHIR and CQL artifacts. You can author and edit CQL libraries, test them against your own FHIR data, run official engine compatibility tests, browse and validate terminology, and more.

CQL Studio can be deployed in many ways: locally, in a shared team environment, or as a public or cloud-hosted instance. These tutorials focus on a typical local deployment, but the same areas and workflows apply in other environments. Also note that certain areas are optional, such as AI integration features, and won't be visible unless configured.

We'll be using the official everygreen distribution published to HL7 Foundry, which is targetted to local CQL users wanting to run CQL Studio on your local laptop, and is tested to deploy out-of-the-box via Docker. If you don't have Docker Desktop installed, do that now. The evergreen distribution always uses the latest releases of all components, so expect things to change.

You'll need to be logged in to Foundry with your free HL7 account. Just search for CQL Studio. You might see some component products but the one you want is the complete bundle called just "CQL Studio".
https://foundry.hl7.org/products/fb509f14-5bc1-491b-a145-fab078a901c0

You'll want to go to the Configuration tab and download a generated configuration file for Docker Desktop. Save that wherever you like, and then go to the Instructions tab for the command you'll need to run. In your system Terminal or console, navigate to the directory and run the command. This will download all the current software images, which may take a minute, and start them up.

Once that's running, go back to the Foundry instructions for the clickable links which will now be available on your computer.


---


# Overview and Settings


CQL Studio default to using your operating system-defined theme mode, which is either light or dark. Mine happens to be dark and this is is changable in system settings. The UI is organized around the top navigation bar. Under **Testing** you’ll find tools related to CQL engine development and testing. Under **Authoring** you have the Terminology Browser and the CQL IDE. And under **Tools** you’ll find the FHIR Uploader and other future utilities. **Settings** is where you set your FHIR data server URL, terminology server URLs, and many other things. Note that some features have dependencies, and will be disabled if you don't have the required components in your deployment.


Global settings control how CQL Studio talks to your FHIR server, optional seperate terminology server, optional AI endpoint, and many other things. The most important are the FHIR base URL, which is used for both data and CQL Library storage, as well as your optional terminology server info for value set and code lookups. These values are stored in your browser (localStorage) and persist across sessions local to your browser.

If you have an Ollama AI endpoint available, either on your local computer or accessible on your network, you can also opt in to AI feature and provide that endpoint.

---

# FHIR Uploader

The FHIR Uploader under the Tools menu allows you to upload your own FHIR Bundle content in JSON format, as well as raw CQL text files.

The best way to get started is to use the **Add Built-In Examples** button that adds a few small synthetic data files that come bundled with CQL Studio, as well as "Hello, World" CQL code example in one step.

If you're using Synthea data, note that Synthea-produced files have to be loaded in a certain order. There's a special **Reorder Synthea Dependencies** button that automatically reorders things to the correct order based on Synthea's file naming conventions. Each row can be rearranged via the buttons or drag and drop.

Assuming your FHIR data server is up and available, the "Upload Bundles" will upload everything in sequence, and will go as fast as the server can process them. After an upload, each file will show a success or failure status.

If you have developer mode enabled, you'll also see a **Danger Zone** section at the bottom with the ability to completely wipe your FHIR data server. That can be very handy but is also irreversable, which is why it's hidden by default.


---

# Terminology Browser and Application Clipboard

CQL Studio's default application settings use your FHIR data server as a terminology server. If you'd like to use something else, such as HL7's public terminology server, you can provide its base URL in Settings.

The Terminology Browser in the Authoring menu lets you search and inspect value sets, concept maps, and code systems on your configured FHIR terminology server, as well validate codes. It isn't intended to be a full terminology authoring and management environment, but more of a quick way to locate value sets or codings from your terminology server and then add them to the app Clipboard for use in the IDE and elsewhere in the application. We'll get to that in a minute.

Note that the specifications of how CQL engines resolve terminology is expect to change to support more sophisticated routing instead of a single terminology endpoint, so this area will evolve as the implementation guides change.

Unlike most other areas of CQL Studio, the Terminology Browser communicates primarily with your terminology endpoint in Settings. So if you're not seeing what you expect, check your settings and make sure you're not confusing your FHIR data endpoint with your terminology endpoint.

To view your Clipboard, go to the Tools menu and select Clipboard Manager. You can think of the Clipboard as a temporary space to keep FHIR objects you're currently working on. If you have AI services set up, Clipboard content will also be accessible to the underlying LLM.

The search interface in the clipboard manager is querying your FHIR data endpoint, not your terminology endpoint. So you can add anything from Patient and Practitioner resources to any other resource exposed by your FHIR server. And the interface is dynamic so it will attempt to provide only the search functions as claimed by the FHIR server's metadata endpoint.


---

# CQL IDE

The CQL IDE under the Authoring menu is the main place for authoring CQL logic itself. You can open existing libraries from your FHIR server, create new ones, edit and save them, and of course run them using data stored on your FHIR server. CQL with syntax highlighting and diagnostics, translate to ELM, save back to the server, and execute against your configured FHIR data.

The layout has left, right, and bottom panels with tabs that can be rearranged, which is a common paradigm for those familiar with other IDEs. And you can also quickly insert terminology content from the Clipboard tab, and if you AI set up, can even provide files to help with automated CQL drafting. Supported file types include plain text, comma-separate value (or CSV) files, PDFs, Word documents, Markdown, and others.

Note that the AI performance and quirkiness is very heavily dependent on the specific model you are using. Is a general rule of thumb you can run anything that Ollama model runner supports, but set your expectations accordingly for what's possible on the hardware you're running it on.

To run the current CQL library in Patient context, search and open it, select any number of Patient resources on your server,  then click **Execute**. Execution progress and results appear in the Console tab. Keyboard shortcuts are also listed on the welcome screen.


---

# Engine Test Runner

Now let's talk about CQL engine testing.

The Test Runner under the Testing menu runs the official CQL engine compatibility test suite against a test runner API, so engine and tooling developers can verify their implementation against the same tests. Test Results (under Testing) is where you open or view saved result files from past runs.

Open the Test Runner from the top menu: **Testing** then **Test Runner**. This screen lets you run the official CQL engine compatibility test suite against a test runner API.

At the top you have a few controls: switch between **Form Editor** and **JSON Editor** to edit the run configuration, **Reset** to restore defaults, and **Recheck Tests Runner Health** to verify the runner API is reachable. If the API is unavailable, the main **Run Tests** button will be disabled and show “API Unavailable.”

The configuration is split into cards. **FHIR Server Configuration** defines the Base URL of the FHIR server used by the tests, the CQL operation—typically dollar-sign “cql”—and optionally an Original Base URL. **CQL Configuration** covers the CQL file version, CQL version for test filtering, a test run description, and optional translator and engine names and versions. There’s also a **Quick Test** option to run only smoke tests. A **Tests** section can define a results path and a skip list for excluding specific tests.

You can edit everything in the form, or switch to the **JSON Editor** to paste or load a full configuration from a JSON file. Use **Validate** to check the JSON, **Load from JSON** to load a file, and **Update from Form** to sync the JSON with the current form values.

When you’re ready, click **Run Tests**. A job is created and the page polls for status. You’ll see a warning to stay on the page while tests are queued and running. The **Job Status** card shows job ID, created time, elapsed time, and status—pending, in progress, completed, or failed. When the job completes successfully, you can **Download Results JSON** or **View Results** to open the results viewer. If the job fails, the error message is shown in the status area.

---

# Engine Test Results

Open the Test Results screen from **Testing** then **Test Results**. You can open results in three ways. **Open Local File** lets you select a JSON file from your machine; the file is not uploaded. **Load from URL** accepts a single URL to a results JSON file—paste the URL and click Load, or use Example to try a sample. **Load an Entire Index** is for a summary index: enter a URL to a JSON file that contains metadata or where to locate individual result files, then click **Load Index**. After the index loads, you’ll see a list of available files. Click **Summary Dashboard & Comparison Matrix** to open the dashboard and compare all results in the index side by side, or click **Load** next to any filename to open that single results file in the results viewer.