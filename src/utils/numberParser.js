/**
 * 数字解析和格式化工具
 * 提供数字转换和格式化功能
 */

/**
 * 将值转换为数字，如果无法转换则返回原值
 * @param {*} value - 输入值
 * @returns {number|*} - 转换后的数字或原值
 */
function tryParseNumber(value) {
    if (value === null || value === undefined || value === '') {
        return value;
    }

    // 如果是数字类型，直接返回
    if (typeof value === 'number') {
        return value;
    }

    // 尝试转换为数字
    const num = Number(value);

    // 检查是否为有效数字且不是NaN
    if (!isNaN(num) && isFinite(num)) {
        return num;
    }

    // 无法转换为数字，返回原值
    return value;
}

/**
 * 格式化数字为固定位数（带前导零）
 * 根据数字大小自动选择位数：1-999用3位，1000-9999用4位，以此类推
 * @param {number} num - 要格式化的数字
 * @returns {string} - 固定位数格式的字符串
 */
function formatToFixedDigits(num) {
    if (typeof num !== 'number' || isNaN(num) || !isFinite(num)) {
        return String(num);
    }

    // 确保数字为正数
    if (num < 0) {
        return String(num);
    }

    // 根据数字大小自动确定位数
    let digits = 3; // 默认3位
    if (num >= 1000 && num < 10000) {
        digits = 4; // 1000-9999用4位
    } else if (num >= 10000 && num < 100000) {
        digits = 5; // 10000-99999用5位
    } else if (num >= 100000) {
        digits = 6; // 100000及以上用6位
    }

    // 格式化为固定位数
    return num.toString().padStart(digits, '0');
}

/**
 * 处理id变量的值：如果能转为数字则用固定位数格式，否则原样输出
 * @param {*} value - id变量的值
 * @returns {string} - 处理后的字符串
 */
function formatIdValue(value) {
    const parsed = tryParseNumber(value);

    if (typeof parsed === 'number') {
        return formatToFixedDigits(parsed);
    }

    // 无法转换为数字，返回原值
    return String(value);
}

/**
 * 将字母数字组合的id转换为可排序的数值格式
 * @param {string} id - 字母数字组合的id（如m001、s001）
 * @returns {string|number} 转换后的数值格式
 */
function convertAlphaNumericId(id) {
    // 匹配字母前缀和数字后缀
    const match = id.match(/^([a-zA-Z]+)(\d+)$/);
    if (match) {
        const letters = match[1];
        const numbers = match[2];

        // 将字母转换为ASCII码值（每个字母占3位以确保唯一性）
        let lettersAsNumbers = '';
        for (let i = 0; i < letters.length; i++) {
            const charCode = letters.charCodeAt(i);
            // 格式化ASCII码为3位数字，前面补0
            lettersAsNumbers += String(charCode).padStart(3, '0');
        }

        // 组合字母ASCII码和数字部分
        return lettersAsNumbers + numbers;
    }
    // 如果不是字母数字组合，返回原值
    return id;
}

export { tryParseNumber, formatToFixedDigits, formatIdValue, convertAlphaNumericId };
