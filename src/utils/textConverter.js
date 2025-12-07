// 简单的双引号转<q>标签工具和反引号转<code>标签工具

/**
 * 将文本中的双引号（包括各种语言的双引号）转换为<q>标签，以及反引号转换为<code>标签
 * @param {string} text - 要处理的文本
 * @returns {string} 处理后的文本
 */
export function convertQuotesToQTags(text) {
    if (typeof text !== 'string' || text.trim() === '') {
        return text;
    }

    let result = text;

    // 首先处理反引号，转换为<code>标签
    const backtickPattern = /`([^`]*)`/g;
    result = result.replace(backtickPattern, '<code>$1</code>');

    // 定义各种语言的双引号模式
    const quotePatterns = [
        // 英文双引号
        /"([^"]*)"/g,
        // 中文双引号
        /"([^”]*)”/g,
        // 日文双引号
        /「([^」]*)」/g,
        // 法文双引号
        /«([^»]*)»/g,
        // 德文双引号
        /„([^“]*)“/g,
        // 其他双引号变体
        /『([^』]*)』/g,
        /〝([^〞]*)〞/g,
        /﹁([^﹂]*)﹂/g,
        /﹃([^﹄]*)﹄/g
    ];

    // 对每种引号模式进行替换，将整个引号内容包裹在<q>标签中
    quotePatterns.forEach(pattern => {
        result = result.replace(pattern, '<q>$&</q>');
    });

    return result;
}

/**
 * 处理文本中的双引号转换（主函数）
 * @param {string} text - 要处理的文本
 * @returns {string} 处理后的文本
 */
export function processQuotes(text) {
    return convertQuotesToQTags(text);
}

// 导出默认函数
export default processQuotes;
