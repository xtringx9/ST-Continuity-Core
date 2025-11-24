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

export { removeHyphens };
