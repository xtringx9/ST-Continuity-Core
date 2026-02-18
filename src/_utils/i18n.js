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
            "label_name": "模块名称",
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
            "label_compatible_modules": "兼容模块",
            "label_compatible_variables": "兼容变量",
            "label_prompt_timing": "生成时机提示词",
            "label_prompt_gen": "生成内容提示词",
            "label_prompt_usage": "使用方法提示词",
            "label_prompt_position": "顺序提示词",
            "label_styles_container": "容器样式",
            "label_styles_external": "外部样式",
            "label_styles_custom": "自定义样式",
            "label_item_min": "最小值",
            "label_item_max": "最大值/数量",
            "title_variables": "变量管理",
            "btn_add_variable": "添加变量",
            "label_var_name": "变量名",
            "label_var_display_name": "显示名称",
            "label_var_description": "描述",
            "label_var_enabled": "启用",
            "label_var_identifier": "设为主标识符",
            "label_var_backup_identifier": "设为备用标识符",
            "label_var_hide_condition": "设为隐藏条件",
            "label_var_hide_values": "隐藏条件值 (逗号分隔)",
            "label_var_no_normalize": "不进行规范化处理",
            "label_var_custom_styles": "自定义样式",
            "label_source_settings": "来源设置",
            "label_module_tag": "模块标签",
            "label_module_update_tag": "更新标签",
            "label_compatible_module_tags": "兼容更新标签 (逗号分隔)",
            "label_cot_tags": "思维链标签 (逗号分隔)",
            "label_content_tag": "正文标签 (逗号分隔)",
            "label_content_remain_layers": "正文保留层数",
            "label_floor_start": "起始楼层",
            "label_floor_end": "结束楼层",
            "label_select_modules": "选择模块",
            "btn_extract": "开始提取",
            "label_results": "提取结果"
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
            "label_compatible_modules": "Compatible Modules",
            "label_compatible_variables": "Compatible Variables",
            "label_prompt_timing": "Timing Prompt",
            "label_prompt_gen": "Generation Prompt",
            "label_prompt_usage": "Usage Prompt",
            "label_prompt_position": "Position Prompt",
            "label_styles_container": "Container Styles",
            "label_styles_external": "External Styles",
            "label_styles_custom": "Custom Styles",
            "label_item_min": "Min",
            "label_item_max": "Max/Count",
            "title_variables": "Variables",
            "btn_add_variable": "Add Variable",
            "label_var_name": "Variable Name",
            "label_var_display_name": "Display Name",
            "label_var_description": "Description",
            "label_var_enabled": "Enabled",
            "label_var_identifier": "Main Identifier",
            "label_var_backup_identifier": "Backup Identifier",
            "label_var_hide_condition": "Hide Condition",
            "label_var_hide_values": "Hide Values (comma separated)",
            "label_var_no_normalize": "No Normalize",
            "label_var_custom_styles": "Custom Styles",
            "label_source_settings": "Source Settings",
            "label_module_tag": "Module Tag",
            "label_module_update_tag": "Update Tag",
            "label_compatible_module_tags": "Compatible Update Tags",
            "label_cot_tags": "CoT Tags",
            "label_content_tag": "Content Tags",
            "label_content_remain_layers": "Content Remain Layers",
            "label_floor_start": "Start Floor",
            "label_floor_end": "End Floor",
            "label_select_modules": "Select Modules",
            "btn_extract": "Start Extraction",
            "label_results": "Results"
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