/**
 * 标识符解析工具
 * 统一处理标识符变量的多值解析，支持中英文逗号、中英文分号作为分隔符
 */

class IdentifierParser {
    /**
     * 解析标识符变量的多值
     * @param {string|number} value 标识符变量的值
     * @returns {Array} 解析后的值数组（已去空格）
     */
    static parseMultiValues(value) {
        if (value === null || value === undefined || value === '') {
            return [];
        }

        // 将数字转换为字符串进行处理
        const stringValue = String(value);

        // 支持的分隔符：英文逗号、中文逗号、英文分号、中文分号
        const separators = [',', '，', ';', '；', '、', '/'];

        // 使用正则表达式分割字符串，支持多种分隔符
        const regex = new RegExp(`[${separators.map(s => '\\' + s).join('')}]`);

        // 分割并去除空格
        return stringValue.split(regex)
            .map(v => v.trim())
            .filter(v => v.length > 0);
    }

    /**
     * 检查两个标识符值是否匹配（支持多值匹配）
     * @param {string} value1 第一个标识符值
     * @param {string} value2 第二个标识符值
     * @returns {boolean} 是否匹配
     */
    static isIdentifierMatch(value1, value2) {
        if (!value1 || !value2) {
            return false;
        }

        // 解析两个值的多值
        const values1 = this.parseMultiValues(value1);
        const values2 = this.parseMultiValues(value2);

        // 如果都是空数组，则不匹配
        if (values1.length === 0 && values2.length === 0) {
            return false;
        }

        // 如果有一个是空数组，另一个不是，则不匹配
        if (values1.length === 0 || values2.length === 0) {
            return false;
        }

        // 检查两个值数组是否包含相同的元素（不考虑顺序）
        const result = values1.length === values2.length &&
            values1.every(val => values2.includes(val)) &&
            values2.every(val => values1.includes(val));

        // console.log(`[IdentifierParser] 检查标识符匹配: ${value1} vs ${value2}, 结果: ${result}`, values1, values2);
        return result;
    }

    /**
     * 检查标识符值是否包含指定的值（支持多值匹配）
     * @param {string} identifierValue 标识符值
     * @param {string} targetValue 目标值
     * @returns {boolean} 是否包含
     */
    static containsValue(identifierValue, targetValue) {
        if (!identifierValue || !targetValue) {
            return false;
        }

        // 解析标识符值的多值
        const values = this.parseMultiValues(identifierValue);

        // 解析目标值的多值
        const targetValues = this.parseMultiValues(targetValue);

        // 检查标识符值是否包含所有目标值
        return targetValues.every(targetVal => values.includes(targetVal));
    }

    /**
     * 获取标识符值的规范化形式（用于比较）
     * @param {string} value 标识符值
     * @returns {string} 规范化后的字符串（排序后的值用逗号连接）
     */
    static getNormalizedValue(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }

        // 解析多值并排序
        const values = this.parseMultiValues(value).sort();

        // 用逗号连接（英文逗号）
        return values.join(',');
    }

    /**
     * 解析时间变量（从moduleProcessor.js迁移）
     * @param {string} timeVal 时间值
     * @param {string} referenceTimeStr 参考时间字符串
     * @param {Date} referenceTime 参考时间对象
     * @returns {string} 处理后的时间字符串
     */
    static parseTimeVariable(timeVal, referenceTimeStr, referenceTime) {
        if (!timeVal || /^\d{1,2}:\d{1,2}$/.test(timeVal)) {
            if (!timeVal) {
                // time为空，直接使用参考时间
                return referenceTimeStr;
            } else {
                // 只有时分，需要合并到参考时间的年月日
                const timeParts = timeVal.split(':');
                const hours = parseInt(timeParts[0], 10);
                const minutes = parseInt(timeParts[1], 10);

                // 创建新的时间对象，使用参考时间的年月日和当前模块的时分
                const referenceDate = new Date(referenceTime);
                const newDate = new Date(referenceDate.getFullYear(),
                    referenceDate.getMonth(),
                    referenceDate.getDate(),
                    hours, minutes);

                // 格式化回与参考时间相同的格式
                return this.formatTimeToSamePattern(referenceTimeStr, newDate);
            }
        }

        // 如果不是HH:MM格式，直接返回原值
        return timeVal;
    }

    /**
     * 根据参考时间字符串的格式，格式化新的时间对象（从moduleProcessor.js迁移）
     * @param {string} referenceTimeStr 参考时间字符串
     * @param {Date} date 要格式化的时间对象
     * @returns {string} 格式化后的时间字符串
     */
    static formatTimeToSamePattern(referenceTimeStr, date) {
        // 根据参考时间的格式返回相应格式的时间字符串
        if (/^\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
            // 格式：2023年09月30日 21:30
            return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        } else if (/^\d{2}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
            // 格式：24年4月11日 08:23
            return `${String(date.getFullYear()).slice(-2)}年${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        } else if (/^\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
            // 格式：2023-09-30 21:30
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        } else if (/^\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{1,2}$/.test(referenceTimeStr)) {
            // 格式：2023/09/30 21:30
            return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        } else {
            // 默认格式
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
    }
}

// 导出类
export { IdentifierParser };
