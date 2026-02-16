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
            "search_placeholder": "搜索模块..."
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
            "search_placeholder": "Search modules..."
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