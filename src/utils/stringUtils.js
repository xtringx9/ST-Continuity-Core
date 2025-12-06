/**
 * 字符串处理工具
 * 提供各种字符串处理方法
 */

/**
 * 去掉字符串中的'-'符号
 * @param {string} str - 输入字符串
 * @returns {string} - 去掉'-'后的字符串
 */
function removeHyphens(str) {
    if (typeof str !== 'string') {
        return str;
    }
    return str.replace(/-/g, '');
}

/**
 * 移除字符串中除了下划线之外的所有特殊符号
 * 保留字母、数字、下划线和emoji
 * 移除标点符号、空格、数学符号等
 * @param {string} str - 输入字符串
 * @returns {string} - 处理后的字符串
 */
function removeSpecialSymbols(str) {
    if (typeof str !== 'string') {
        return str;
    }

    // 正则表达式说明：
    // [^\w_] - 匹配除了字母、数字、下划线之外的字符
    // \s - 匹配所有空白字符（空格、制表符、换行等）
    // 使用g标志进行全局替换
    return str.replace(/[^\w_\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]|\s/gu, '');
}

export { removeHyphens, removeSpecialSymbols };
