/**
 * 通用国际化 (i18n) 工具类
 */

const resources = {
    "zh-CN": {
        "module_editor": {
            "nav_modules": "模块定义",
            "nav_profiles": "角色覆盖",
            "nav_tools": "工具箱",
            "nav_settings": "全局设置",
            "tag_external": "外部显示",
            "tag_time_ref": "时间基准",
            "tag_disabled": "已禁用",
            "search_placeholder": "搜索模块...",
            "title_edit_module": "编辑模块",
            "label_name": "模块名称 (ID)",
            "label_display_name": "显示名称",
            "label_description": "描述",
            "label_enabled": "启用状态",
            "btn_save": "保存修改",
            "label_output_pos": "生成位置",
            "label_output_mode": "输出模式",
            "label_range_mode": "数量限制",
            "label_retain_layers": "保留层数",
            "label_time_ref": "作为时间基准",
            "label_external": "外部显示",
            "label_prompt_timing": "生成时机提示词",
            "label_prompt_gen": "生成内容提示词",
            "label_prompt_usage": "使用方法提示词",
            "label_styles_container": "容器样式 (CSS)"
        }
        // 未来可以添加其他模块的翻译，例如 "settings": { ... }
    },
    "en-US": {
        "module_editor": {
            "nav_modules": "Modules",
            "nav_profiles": "Profiles",
            "nav_tools": "Tools",
            "nav_settings": "Settings",
            "tag_external": "External",
            "tag_time_ref": "Time Ref",
            "tag_disabled": "Disabled",
            "search_placeholder": "Search modules...",
            "title_edit_module": "Edit Module",
            "label_name": "Name (ID)",
            "label_display_name": "Display Name",
            "label_description": "Description",
            "label_enabled": "Enabled",
            "btn_save": "Save Changes",
            "label_output_pos": "Output Position",
            "label_output_mode": "Output Mode",
            "label_range_mode": "Range Limit",
            "label_retain_layers": "Retain Layers",
            "label_time_ref": "Time Reference",
            "label_external": "External Display",
            "label_prompt_timing": "Timing Prompt",
            "label_prompt_gen": "Generation Prompt",
            "label_prompt_usage": "Usage Prompt",
            "label_styles_container": "Container Styles"
        }
    }
};

class I18n {
    constructor() {
        this.currentLang = "zh-CN"; // 默认语言，实际可从配置读取
    }

    setLanguage(lang) {
        if (resources[lang]) {
            this.currentLang = lang;
        }
    }

    t(key, section) {
        const langData = resources[this.currentLang];
        if (langData && langData[section] && langData[section][key]) {
            return langData[section][key];
        }
        return key;
    }

    apply(container = document, section) {
        container.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key, section);

            if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
                el.placeholder = text;
            } else {
                el.textContent = text;
            }
        });
    }
}

export const i18n = new I18n();