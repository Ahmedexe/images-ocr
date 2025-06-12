import { App, Plugin, Notice, Modal, TextComponent, ButtonComponent, FileSystemAdapter, PluginSettingTab, Setting, ItemView, WorkspaceLeaf } from 'obsidian';
import * as Tesseract from 'tesseract.js';
import * as fs from 'fs';

const OCR_VIEW_TYPE = 'ocr-sidebar-view';

interface OCRPluginSettings {
  defaultImageFolder: string;
  ocrLang: string;
}

// default config
const DEFAULT_SETTINGS: OCRPluginSettings = {
  defaultImageFolder: 'attachments/',
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
    
        const adapter = this.app.vault.adapter;
        if (!(adapter instanceof FileSystemAdapter)) {
          new Notice("Unsupported vault adapter.");
          return;
        }
        const baseFolder = this.settings.defaultImageFolder.replace(/^\/|\/$/g, ''); // remove leading/trailing slashes
        const fullRelativePath = `${baseFolder}/${imageFile}`;

        const fullPath = adapter.getFullPath(fullRelativePath);
        const buffer = fs.readFileSync(fullPath);

        if (!fs.existsSync(fullPath)) {
          new Notice("File not found: " + fullRelativePath); 
          return;
        }
        if (!fs.statSync(fullPath).isFile()) {
          new Notice("Path is a directory, not a file.");
          return;
        }
        
    
        new Notice(`Running OCR on ${imageFile}...`);
        try {
          const result = await Tesseract.recognize(buffer, this.settings.ocrLang); // use Tesseract
          const text = result.data.text;
    
          // Copy to clipboard using web API
          await navigator.clipboard.writeText(text);
          new Notice("OCR result copied to clipboard :)");
          await this.showOcrResultInSidebar(text, imageFile, this.settings.ocrLang); // show the result in the sidebar
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
        new SetLanguageModal(this.app, (langCode) => {
          this.settings.ocrLang = langCode;
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
          const adapter = this.app.vault.adapter;
          if (!(adapter instanceof FileSystemAdapter)) {
            new Notice("Unsupported adapter.");
            return;
          }
    
          const fullPath = adapter.getFullPath(userPath);
    
          // Validate the path
          if (!fs.existsSync(fullPath)) {
            new Notice("File does not exist.");
            return;
          }
          if (!fs.statSync(fullPath).isFile()) {
            new Notice("Path is not a file.");
            return;
          }
    
          try {
            new Notice(`Running OCR (${this.settings.ocrLang})...`);
            const buffer = fs.readFileSync(fullPath);
            const result = await Tesseract.recognize(buffer, this.settings.ocrLang);
            const text = result.data.text

            // Copy to clipboard
            await navigator.clipboard.writeText(text);
            new Notice("OCR result copied to clipboard :)");
            await this.showOcrResultInSidebar(text, fullPath, this.settings.ocrLang); // show results in sidebar
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
    title.style.marginBottom = '0.5rem';

    const pre = container.createEl("pre", { text: this.content });
    this.containerEl.style.overflow = 'auto';
    
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-word';
    pre.style.overflowY = 'auto';
    pre.style.maxHeight = '100%';
    pre.style.padding = '8px';
    pre.style.userSelect = 'text';
    pre.style.cursor = 'text';

    // make the text direction to right if the language is arabic
    if (isArabic) {
      pre.style.direction = 'rtl';
      pre.style.textAlign = 'right';
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
    contentEl.createEl('h2', { text: 'Enter relative image path (e.g., attachments/image.png)' });

    const input = new TextComponent(contentEl);
    input.inputEl.style.width = '100%';
    input.inputEl.style.marginBottom = '2vh'; // or '5vw'

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
    input.inputEl.style.width = '100%';
    input.inputEl.style.marginBottom = '2vh'; // or '5vw'



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
      .setDesc('Relative to vault (e.g., attachments/)')
      .addText(text => text
        .setPlaceholder('attachments/')
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



