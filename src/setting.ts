import SmoothCursorPlugin from "src/main";
import { App, PluginSettingTab, Setting } from "obsidian";

export class SmoothCursorSettingTab extends PluginSettingTab {
    plugin: SmoothCursorPlugin;

    constructor(app: App, plugin: SmoothCursorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        // new Setting(containerEl)
        //     .setName("光标颜色")
        //     .setDesc("设置光标颜色")
        //     .addColorPicker((text) => {
        //         text
        //             .setValue(this.plugin.setting.cursorColor)
        //             .onChange(async (value) => {
        //                 this.plugin.setting.cursorColor = value;
        //                 this.plugin.updateSetting();
        //                 await this.plugin.saveSettings();
        //             })
        //     });


        // new Setting(containerEl)
        //     .setName("光标闪烁速度")
        //     .setDesc("设置光标闪烁速度")
        //     .addText((text) => {
        //         text.inputEl.type = "number";
        //         text
        //             .setValue(this.plugin.setting.blinkSpeed.toString())
        //             .onChange(async (value) => {
        //                 this.plugin.setting.blinkSpeed = Number(value);
        //                 this.plugin.updateSetting();
        //                 await this.plugin.saveSettings();
        //             })
        //     });

        new Setting(containerEl)
            .setName("拖尾开关 Trail enable")
            .setDesc("是否启用拖尾")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.setting.enableTrail)
                    .onChange(async (value) => {
                        this.plugin.setting.enableTrail = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("拖尾颜色 Trail color")
            .setDesc("设置拖尾颜色")
            .addColorPicker((text) => {
                text
                    .setValue(this.plugin.setting.trailColor)
                    .onChange(async (value) => {
                        this.plugin.setting.trailColor = value;
                        await this.plugin.saveSettings();
                    })
            });

        new Setting(containerEl)
            .setName("拖尾速度 Trail speed")
            .setDesc("设置拖尾更新次数，越大越慢 More bigger,more slower")
            .addText((text) => {
                text.inputEl.type = "number";
                text
                    .setPlaceholder("颜色字符串或颜色代码")
                    .setValue(this.plugin.setting.trailStep.toString())
                    .onChange(async (value) => {
                        this.plugin.setting.trailStep = parseInt(value);
                        await this.plugin.saveSettings();
                    })
            });
    }
}