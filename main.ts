import { App, Plugin, Notice, Modal, TextComponent, ButtonComponent, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import * as Tesseract from 'tesseract.js';


const OCR_VIEW_TYPE = 'ocr-sidebar-view';

interface OCRPluginSettings {
  defaultImageFolder: string;
  ocrLang: string;
}

// default config
const DEFAULT_SETTINGS: OCRPluginSettings = {
  defaultImageFolder: 'Attachments/',
  ocrLang: 'eng'
};

export default class OCRPlugin extends Plugin {
  public settings: OCRPluginSettings;
  
  


  async onload() {
    await this.loadSettings();

    this.addSettingTab(new OCRSettingTab(this.app, this));

    // run OCR for the last attached image in the note
    this.addCommand({
      id: 'ocr-image-to-clipboard',
      name: 'OCR of the Last Image in the Active Note',
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice("No active file.");
          return;
        }
    
        const content = await this.app.vault.read(file);

        // determine image links using regix
        const matches = [...content.matchAll(/!\[\[(.+?\.(?:png|jpe?g))\]\]/gi)];

        // find last appended image
        const imageFile = matches[matches.length - 1][1];

        if (matches.length === 0) {
          new Notice("No image found in note.");
          return;
        }

        const baseFolder = this.settings.defaultImageFolder.replace(/^\/|\/$/g, ''); // remove leading/trailing slashes
        const fullRelativePath = `${baseFolder}/${imageFile}`;

        const image = this.app.vault.getAbstractFileByPath(fullRelativePath);
        console.log(fullRelativePath)

        if (!(image instanceof TFile)) {
          new Notice("Image file not found in vault.");
          return;
        }

        
        try {

          const buffer = await this.app.vault.readBinary(image); // <-- returns Uint8Array
          // Convert ArrayBuffer to Blob
          const blob = new Blob([buffer]);
  
          // Create an object URL that Tesseract can consume
          const imageUrl = URL.createObjectURL(blob);
                  
          
      
          new Notice(`Running OCR on ${imageFile}...`);

          const result = await Tesseract.recognize(imageUrl, this.settings.ocrLang); // use Tesseract
          const text = result.data.text;
    
          // Copy to clipboard using web API
          await navigator.clipboard.writeText(text);
          new Notice("OCR result copied to clipboard :)");
          await this.showOcrResultInSidebar(text, imageFile, this.settings.ocrLang); // show the result in the sidebar
          new Notice("OCR result is shown in the side bar :)");
        } catch (err) {
          console.error("OCR failed:", err);
          new Notice("OCR failed.");
        }
      }

      
    });
    

    // change lang code
    this.addCommand({
      id: 'set-ocr-language',
      name: 'Set OCR Language Code',
      callback: () => {
        // prompt the user a modal to enter the lang code
        new SetLanguageModal(this.app, async (langCode) => {
          this.settings.ocrLang = langCode;
          await this.saveSettings();
          new Notice(`OCR language set to: ${langCode}`);
        }, this).open();
      }
    });

    // command for user entered path
    this.addCommand({
      id: 'ocr-from-typed-path',
      name: 'OCR using Image Path',
      callback: () => {
        // prompt the user a modal to enter the image path
        new ImagePathInputModal(this.app, async (userPath) => {
        const image = this.app.vault.getAbstractFileByPath(userPath);

          if (!(image instanceof TFile)) {
            new Notice("Image file not found in vault.");
            return;
          }

        
    
          try {
            const buffer = await this.app.vault.readBinary(image); // <-- returns Uint8Array
            // Convert ArrayBuffer to Blob
            const blob = new Blob([buffer]);

            // Create an object URL that Tesseract can consume
            const imageUrl = URL.createObjectURL(blob);
            new Notice(`Running OCR (${this.settings.ocrLang})...`);
            
            const result = await Tesseract.recognize(imageUrl, this.settings.ocrLang);
            const text = result.data.text

            // Copy to clipboard
            await navigator.clipboard.writeText(text);
            new Notice("OCR result copied to clipboard :)");
            await this.showOcrResultInSidebar(text, imageUrl, this.settings.ocrLang); // show results in sidebar
            new Notice("OCR result is shown in the side bar :)");
          } catch (err) {
            console.error("OCR failed:", err);
            new Notice("OCR failed.");
          }
        }).open();
      }
    });
    
    // register the sidebar view
    this.registerView(
      OCR_VIEW_TYPE,
      (leaf) => new OcrSidebarView(leaf, "", "", "")
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension.match(/png|jpe?g/i)) {
          menu.addItem(item => {
            item.setTitle("Run OCR and show result in sidebar")
                .setIcon("eye") // or use another suitable icon
                .onClick(async () => {
                  const image = this.app.vault.getAbstractFileByPath(file.path);

                  if (!(image instanceof TFile)) {
                    new Notice("Image file not found in vault.");
                    return;
                  }

                  
                  try {

                    const buffer = await this.app.vault.readBinary(image); // <-- returns Uint8Array
                    // Convert ArrayBuffer to Blob
                    const blob = new Blob([buffer]);

                    // Create an object URL that Tesseract can consume
                    const imageUrl = URL.createObjectURL(blob);
                    new Notice(`Running OCR (${this.settings.ocrLang})...`);
                    const result = await Tesseract.recognize(imageUrl, this.settings.ocrLang);
                    const text = result.data.text

                    await navigator.clipboard.writeText(text);
                    new Notice("OCR result copied to clipboard :)");
                    await this.showOcrResultInSidebar(text, file.path, this.settings.ocrLang); // show results in sidebar
                    new Notice("OCR result is shown in the side bar :)");
                  } catch (err) {
                    console.log(err);
                  }
                  
                });
          });
        }
      })
    );
    
  
  }
  // show OCR in sidebar
  async showOcrResultInSidebar(resultText: string, path: string, language: string) {
    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true);
    if (leaf) {
      await leaf.setViewState({
        type: OCR_VIEW_TYPE,
        active: true
      });
    
      // pass values
      const view = leaf.view as OcrSidebarView;
      (view as any).content = resultText;
      (view as any).title = path;
      (view as any).lang = language;
      await view.onOpen();
    }
    
    
  }
  
  // load user settings
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  
  // save user settings if altered
  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// sidebar config
class OcrSidebarView extends ItemView {
  private content: string;
  

  constructor(leaf: WorkspaceLeaf, private title: string, content: string, private lang: string) {
    super(leaf);
    this.content = content;
  }

  getViewType(): string {
    return OCR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "OCR Result";
  }

  // construct sidebar view
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();

    const isArabic = this.lang === 'ara';

    const title = container.createEl('h3', { text: `OCR Result from: ${this.title}` });
    title.classList.add(".ocr-title")

    const pre = container.createEl("pre", { text: this.content });
    this.containerEl.classList.add("ocr-container");
    
    pre.classList.add("ocr-output");

    // make the text direction to right if the language is arabic
    if (isArabic) {
      pre.classList.add("isArabic")
    }
  }

  async onClose() {
    this.content = '';
  }
}

// path entering modal
class ImagePathInputModal extends Modal {
  onSubmit: (path: string) => void;

  constructor(app: App, onSubmit: (path: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  // construct the view
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Enter relative image path (e.g., Attachments/image.png)' });

    const input = new TextComponent(contentEl);
    input.inputEl.classList.add("modal-input")

    // set submit button
    new ButtonComponent(contentEl)
      .setButtonText('Run OCR')
      .onClick(() => {
        const value = input.getValue().trim();
        if (value) {
          this.onSubmit(value);
        } else {
          new Notice("Please enter a valid image path.");
        }
        this.close();
      });
  }

  onClose() {
    this.contentEl.empty();
  }
}


// language code select modal
class SetLanguageModal extends Modal {
  plugin: OCRPlugin;
  onSubmit: (lang: string) => void;

  constructor(app: App, onSubmit: (lang: string) => void, plugin: OCRPlugin) {
    super(app);
    this.onSubmit = onSubmit;
    this.plugin = plugin
  }

  // construct the view
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: 'Enter OCR language code (e.g., eng, ara, fra)' });

    const input = new TextComponent(contentEl);
    input.setValue(this.plugin.settings.ocrLang);
    input.inputEl.classList.add("modal-input")



    new ButtonComponent(contentEl)
      .setButtonText('Set Language')
      .onClick(() => {
        const lang = input.getValue().trim();
        if (lang) this.onSubmit(lang);
        this.close();
      });
  }

  onClose() {
    this.contentEl.empty();
  }
  
}

// setttings tab
class OCRSettingTab extends PluginSettingTab {
  plugin: OCRPlugin;

  constructor(app: App, plugin: OCRPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'OCR Plugin Settings' });

    // image default path setting
    new Setting(containerEl)
      .setName('Default image folder path')
      .setDesc('Relative to vault (e.g., Attachments/)')
      .addText(text => text
        .setPlaceholder('Attachments/')
        .setValue(this.plugin.settings.defaultImageFolder)
        .onChange(async (value) => {
          this.plugin.settings.defaultImageFolder = value.trim();
          await this.plugin.saveSettings();
        })
      );

    // langauge code setting
    new Setting(containerEl)
      .setName('OCR language code')
      .setDesc('e.g., eng, ara, fra')
      .addText(text => text
        .setPlaceholder('eng')
        .setValue(this.plugin.settings.ocrLang)
        .onChange(async (value) => {
          this.plugin.settings.ocrLang = value.trim();
          await this.plugin.saveSettings();
        })
      );
  }
}



