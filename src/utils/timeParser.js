/**
 * 时间解析工具
 * 支持多种时间格式，返回结构化的时间数据
 */

import { debugLog } from "../index.js";

/**
 * 解析时间字符串，返回结构化的时间数据
 * @param {string} timeStr 时间字符串
 * @returns {Object} 结构化的时间数据
 */
/**
 * 基于standardTimeValue重新计算时间对象的weekday
 * @param {Object} timeObj 时间对象
 * @param {Object} standardTimeData 标准时间对象
 * @returns {string} 重新计算后的weekday
 */
function recalculateWeekday(timeObj, standardTimeData) {
    if (!timeObj || !timeObj.hasDate || !standardTimeData) {
        return timeObj?.weekday || '';
    }

    // 创建日期对象
    const date = new Date(timeObj.year, timeObj.month - 1, timeObj.day);

    // 如果有standardTimeValue，使用其作为标准来计算
    if (standardTimeData.startTime && standardTimeData.startTime.isValid &&
        standardTimeData.startTime.year && standardTimeData.startTime.month && standardTimeData.startTime.day &&
        standardTimeData.startTime.weekday) {

        // 创建标准时间的日期对象
        const standardDate = new Date(
            standardTimeData.startTime.year,
            standardTimeData.startTime.month - 1,
            standardTimeData.startTime.day
        );

        // 计算目标日期与标准日期之间的天数差
        const dayDiff = Math.floor((date - standardDate) / (1000 * 60 * 60 * 24));

        // 获取标准日期的weekday对应的索引
        const weekdayMap = {
            '周日': 0, '周一': 1, '周二': 2, '周三': 3,
            '周四': 4, '周五': 5, '周六': 6
        };
        const standardWeekdayIndex = weekdayMap[standardTimeData.startTime.weekday] || 0;

        // 根据天数差计算新的weekday索引
        const newWeekdayIndex = (standardWeekdayIndex + dayDiff) % 7;
        const adjustedIndex = newWeekdayIndex >= 0 ? newWeekdayIndex : newWeekdayIndex + 7;

        // 返回对应的weekday
        return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][adjustedIndex];
    }

    // 如果没有有效的standardTimeValue，使用默认方式计算
    return getWeekdayChinese(date);
}

export function parseTimeDetailed(timeStr, standardTimeData) {
    if (!timeStr || typeof timeStr !== 'string') {
        return {
            isValid: false,
            error: '无效的时间字符串',
            isRange: false,
            startTime: null,
            endTime: null,
            formattedString: null
        };
    }
    // if (standardTimeData) {
    //     debugLog(`[TimeDataAttachment WEEKDAY] 标准时间数据: }`, standardTimeData);
    // }

    // 清理字符串
    timeStr = timeStr.trim();

    // 检查是否是时间段
    const timeRangeMatch = timeStr.match(/(.*?)\s*[~\-]\s*(.*)/);
    if (timeRangeMatch) {
        const result = parseTimeRange(timeRangeMatch[1].trim(), timeRangeMatch[2].trim());

        // 在调用formatTimeDataToStandard之前，使用standardTimeValue重新计算weekday
        if (standardTimeData && result.isValid) {
            // 处理开始时间的weekday
            if (result.startTime) {
                const weekday = recalculateWeekday(result.startTime, standardTimeData);
                // 安全比较字符串，处理null、undefined等情况
                const currentWeekday = result.startTime.weekday || '';
                if (currentWeekday !== weekday) {
                    debugLog(`[TimeDataAttachment WEEKDAY] ${result.startTime.year}-${result.startTime.month}-${result.startTime.day} 重新计算后的weekday: ${weekday} 原weekday: ${result.startTime.weekday}`);
                    result.startTime.weekday = weekday;
                }
            }

            // 处理结束时间的weekday
            if (result.endTime) {
                const weekday = recalculateWeekday(result.endTime, standardTimeData);
                // 安全比较字符串，处理null、undefined等情况
                const currentWeekday = result.endTime.weekday || '';
                if (currentWeekday !== weekday) {
                    debugLog(`[TimeDataAttachment WEEKDAY] ${result.endTime.year}-${result.endTime.month}-${result.endTime.day} 重新计算后的weekday: ${weekday} 原weekday: ${result.endTime.weekday}`);
                    result.endTime.weekday = weekday;
                }
            }
        }

        // 添加格式化字符串字段
        result.formattedString = formatTimeDataToStandard(result);
        return result;
    }

    // 解析单个时间点
    const result = parseSingleTime(timeStr);

    // 在调用formatTimeDataToStandard之前，使用standardTimeData重新计算weekday
    if (standardTimeData && result.isValid && result.startTime) {
        const weekday = recalculateWeekday(result.startTime, standardTimeData);
        // 安全比较字符串，处理null、undefined等情况
        const currentWeekday = result.startTime.weekday || '';
        if (currentWeekday !== weekday) {
            debugLog(`[TimeDataAttachment WEEKDAY] ${result.startTime.year}-${result.startTime.month}-${result.startTime.day} 重新计算后的weekday: ${weekday} 原weekday: ${result.startTime.weekday}`);
            result.startTime.weekday = weekday;
        }
    }

    // 添加格式化字符串字段
    result.formattedString = formatTimeDataToStandard(result);
    return result;
}

/**
 * 解析时间段
 * @param {string} startTimeStr 开始时间字符串
 * @param {string} endTimeStr 结束时间字符串
 * @returns {Object} 结构化的时间段数据
 */
function parseTimeRange(startTimeStr, endTimeStr) {
    const startResult = parseSingleTime(startTimeStr);
    const endResult = parseSingleTime(endTimeStr);

    // 如果结束时间只有时间部分且开始时间有日期，使用开始时间的日期
    if (endResult.isValid && endResult.startTime && startResult.isValid && startResult.startTime) {
        // 检查结束时间是否只有时间部分（通过检查是否匹配纯时间格式）
        const timeOnlyPattern = /^\d{1,2}:\d{1,2}(?::\d{1,2})?$/;
        if (timeOnlyPattern.test(endTimeStr.trim()) && startResult.startTime.hasDate) {
            // 复制开始时间的日期信息
            let endYear = startResult.startTime.year;
            let endMonth = startResult.startTime.month;
            let endDay = startResult.startTime.day;

            // 检查结束时间是否比开始时间晚，如果超过12点，则日期加1天
            if (endResult.startTime.hour < startResult.startTime.hour ||
                (endResult.startTime.hour === startResult.startTime.hour && endResult.startTime.minute <= startResult.startTime.minute)) {
                // 结束时间比开始时间早或相等，说明是第二天
                const nextDay = new Date(endYear, endMonth - 1, endDay + 1);
                endYear = nextDay.getFullYear();
                endMonth = nextDay.getMonth() + 1;
                endDay = nextDay.getDate();
            }

            endResult.startTime.year = endYear;
            endResult.startTime.month = endMonth;
            endResult.startTime.day = endDay;
            endResult.startTime.weekday = getWeekdayChinese(new Date(endYear, endMonth - 1, endDay));
            endResult.startTime.hasDate = true;

            // 重新计算时间戳
            const endDate = new Date(
                endResult.startTime.year,
                endResult.startTime.month - 1,
                endResult.startTime.day,
                endResult.startTime.hour,
                endResult.startTime.minute,
                endResult.startTime.second
            );
            endResult.startTime.timestamp = endDate.getTime();

            // 修复：更新结束时间的isComplete状态
            endResult.isComplete = true;
        }
    }
    // 检查是否为不完全时间段
    const isComplete = startResult.isComplete && endResult.isComplete;

    return {
        isValid: startResult.isValid && endResult.isValid,
        error: startResult.isValid && endResult.isValid ? '' : '时间段解析失败',
        isRange: true,
        isComplete: isComplete,
        originalText: `${startTimeStr}~${endTimeStr}`,
        startTime: startResult.startTime,
        endTime: endResult.startTime,
        formattedString: null // 将在parseTimeDetailed中设置
    };
}

/**
 * 解析单个时间点
 * @param {string} timeStr 时间字符串
 * @returns {Object} 结构化的时间数据
 */
function parseSingleTime(timeStr) {
    // 定义时间解析模式（按从具体到通用的顺序）
    const patterns = [
        // 格式1: 2023年09月25日 周一 17:35:30
        {
            pattern: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
            handler: (match) => ({
                year: parseInt(match[1], 10),
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: normalizeWeekday(match[4]),
                hour: parseInt(match[5], 10),
                minute: parseInt(match[6], 10),
                second: match[7] ? parseInt(match[7], 10) : 0
            })
        },
        // 格式2: 24年4月11日 周四 08:23:45
        {
            pattern: /^(\d{2})年(\d{1,2})月(\d{1,2})日\s+(周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
            handler: (match) => ({
                year: parseInt(match[1], 10) + 2000,
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: normalizeWeekday(match[4]),
                hour: parseInt(match[5], 10),
                minute: parseInt(match[6], 10),
                second: match[7] ? parseInt(match[7], 10) : 0
            })
        },
        // 格式3: 2023-09-25/Sat 11:33:22
        {
            pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})\/(周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
            handler: (match) => ({
                year: parseInt(match[1], 10),
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: normalizeWeekday(match[4]),
                hour: parseInt(match[5], 10),
                minute: parseInt(match[6], 10),
                second: match[7] ? parseInt(match[7], 10) : 0
            })
        },
        // 格式4: 2023-09-25 Sat 11:33:15
        {
            pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(周[一二三四五六日]|星期[一二三四五六日]|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
            handler: (match) => ({
                year: parseInt(match[1], 10),
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: normalizeWeekday(match[4]),
                hour: parseInt(match[5], 10),
                minute: parseInt(match[6], 10),
                second: match[7] ? parseInt(match[7], 10) : 0
            })
        },
        // 格式5: 2023-09-25 11:33:10
        {
            pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
            handler: (match) => ({
                year: parseInt(match[1], 10),
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: '',
                hour: parseInt(match[4], 10),
                minute: parseInt(match[5], 10),
                second: match[6] ? parseInt(match[6], 10) : 0
            })
        },
        // 格式6: 2023年09月25日 17:35:05
        {
            pattern: /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
            handler: (match) => ({
                year: parseInt(match[1], 10),
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: '',
                hour: parseInt(match[4], 10),
                minute: parseInt(match[5], 10),
                second: match[6] ? parseInt(match[6], 10) : 0
            })
        },
        // 格式7: 24年4月11日 08:23:59
        {
            pattern: /^(\d{2})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
            handler: (match) => ({
                year: parseInt(match[1], 10) + 2000,
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: '',
                hour: parseInt(match[4], 10),
                minute: parseInt(match[5], 10),
                second: match[6] ? parseInt(match[6], 10) : 0
            })
        },
        // 格式8: 2023-09-25
        {
            pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
            handler: (match) => ({
                year: parseInt(match[1], 10),
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: '',
                hour: 0,
                minute: 0,
                second: 0
            })
        },
        // 格式9: 2023年09月25日
        {
            pattern: /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,
            handler: (match) => ({
                year: parseInt(match[1], 10),
                month: parseInt(match[2], 10),
                day: parseInt(match[3], 10),
                weekday: '',
                hour: 0,
                minute: 0,
                second: 0
            })
        },
        // 格式10: 11:33:45
        {
            pattern: /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/,
            handler: (match) => {
                return {
                    year: 0,
                    month: 0,
                    day: 0,
                    weekday: '',
                    hour: parseInt(match[1], 10),
                    minute: parseInt(match[2], 10),
                    second: match[3] ? parseInt(match[3], 10) : 0
                };
            }
        }
    ];

    // 尝试匹配所有模式
    for (const { pattern, handler } of patterns) {
        const match = timeStr.match(pattern);
        if (match) {
            try {
                const result = handler(match);

                // 检查是否为不完全时间
                const hasDate = result.year > 0 && result.month > 0 && result.day > 0;
                const hasTime = result.hour > 0 || result.minute > 0 || result.second > 0;
                const isComplete = hasDate && hasTime;

                // 验证日期有效性（如果有日期）
                if (hasDate) {
                    const date = new Date(result.year, result.month - 1, result.day, result.hour, result.minute, result.second);
                    if (isNaN(date.getTime())) {
                        continue;
                    }
                }

                // 如果没有星期信息且有日期，计算星期
                let weekday = result.weekday;
                if (!weekday && hasDate) {
                    const date = new Date(result.year, result.month - 1, result.day);
                    weekday = getWeekdayChinese(date);
                }

                // 计算时间戳（如果有完整日期时间）
                const timestamp = hasDate && hasTime ?
                    new Date(result.year, result.month - 1, result.day, result.hour, result.minute, result.second).getTime() : 0;

                return {
                    isValid: true,
                    error: '',
                    isRange: false,
                    isComplete: isComplete,
                    originalText: timeStr,
                    startTime: {
                        year: result.year,
                        month: result.month,
                        day: result.day,
                        weekday: weekday,
                        hour: result.hour,
                        minute: result.minute,
                        second: result.second,
                        timestamp: timestamp,
                        hasDate: hasDate,
                        hasTime: hasTime
                    },
                    endTime: null
                };
            } catch (error) {
                continue;
            }
        }
    }

    // 如果无法解析，返回错误结果
    return {
        isValid: false,
        error: '无法解析的时间格式',
        isRange: false,
        isComplete: false,
        originalText: timeStr,
        startTime: null,
        endTime: null,
        formattedString: null
    };
}

/**
 * 标准化星期表示
 * @param {string} weekday 星期字符串
 * @returns {string} 标准化的星期表示（中文）
 */
function normalizeWeekday(weekday) {
    const weekdayMap = {
        // 中文
        '周一': '周一', '周二': '周二', '周三': '周三', '周四': '周四', '周五': '周五', '周六': '周六', '周日': '周日',
        '星期一': '周一', '星期二': '周二', '星期三': '周三', '星期四': '周四', '星期五': '周五', '星期六': '周六', '星期日': '周日',
        // 英文缩写
        'Mon': '周一', 'Tue': '周二', 'Wed': '周三', 'Thu': '周四', 'Fri': '周五', 'Sat': '周六', 'Sun': '周日',
        // 英文全称
        'Monday': '周一', 'Tuesday': '周二', 'Wednesday': '周三', 'Thursday': '周四', 'Friday': '周五', 'Saturday': '周六', 'Sunday': '周日'
    };

    return weekdayMap[weekday] || weekday;
}

/**
 * 获取日期的中文星期表示
 * @param {Date} date 日期对象
 * @returns {string} 中文星期
 */
function getWeekdayChinese(date) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return weekdays[date.getDay()];
}

/**
 * 格式化时间结果为可读字符串
 * @param {Object} timeResult 时间解析结果
 * @returns {string} 格式化后的时间字符串
 */
export function formatTimeResult(timeResult) {
    if (!timeResult.isValid) {
        return `无效时间: ${timeResult.error}`;
    }

    const { isRange, startTime, endTime } = timeResult;

    if (!startTime) {
        return '无效的开始时间';
    }

    let result = `${startTime.year}年${startTime.month.toString().padStart(2, '0')}月${startTime.day.toString().padStart(2, '0')}日`;

    // 显示星期信息（优先显示开始星期，如果跨日则显示两个星期）
    if (startTime.weekday) {
        if (isRange && endTime && startTime.weekday !== endTime.weekday) {
            result += ` ${startTime.weekday}~${endTime.weekday}`;
        } else {
            result += ` ${startTime.weekday}`;
        }
    }

    if (startTime.hour > 0 || startTime.minute > 0 || startTime.second > 0) {
        result += ` ${startTime.hour.toString().padStart(2, '0')}:${startTime.minute.toString().padStart(2, '0')}`;
        if (startTime.second > 0) {
            result += `:${startTime.second.toString().padStart(2, '0')}`;
        }
    }

    if (isRange && endTime && (endTime.hour !== startTime.hour || endTime.minute !== startTime.minute || endTime.second !== startTime.second)) {
        result += `~${endTime.hour.toString().padStart(2, '0')}:${endTime.minute.toString().padStart(2, '0')}`;
        if (endTime.second > 0) {
            result += `:${endTime.second.toString().padStart(2, '0')}`;
        }
    }

    return result;
}

/**
 * 根据timeData返回标准化的时间格式字符串
 * 用于AI解析和输出的标准格式
 * @param {Object} timeData 时间解析结果
 * @returns {string|null} 格式化后的时间字符串，无效时间返回null
 */
export function formatTimeDataToStandard(timeData) {
    if (!timeData || !timeData.isValid || !timeData.startTime) {
        return null;
    }

    // 检查是否为不完全时间（只有当时间不完全时才返回原文）
    if (timeData.isComplete === false) {
        return timeData.originalText;
    }

    const { isRange, startTime, endTime } = timeData;

    // 数字补零辅助函数
    const padZero = (num) => num.toString().padStart(2, '0');

    // 格式化时间组件（时:分:秒）
    const formatTimeComponent = (timeObj) => {
        let timeStr = `${padZero(timeObj.hour)}:${padZero(timeObj.minute)}`;
        if (timeObj.second > 0) {
            timeStr += `:${padZero(timeObj.second)}`;
        }
        return timeStr;
    };

    if (isRange && endTime) {
        // 时间段格式：YYYY-MM-DD HH:MM:SS - HH:MM:SS
        const startTimeStr = formatTimeComponent(startTime);
        const endTimeStr = formatTimeComponent(endTime);

        // 检查是否为跨日时间段
        const isCrossDay = startTime.year !== endTime.year ||
            startTime.month !== endTime.month ||
            startTime.day !== endTime.day;

        let formattedTime;

        if (isCrossDay) {
            // 跨日时间段：显示两个完整的日期
            formattedTime = `${startTime.year}-${padZero(startTime.month)}-${padZero(startTime.day)} ${startTime.weekday} ${startTimeStr}~${endTime.year}-${padZero(endTime.month)}-${padZero(endTime.day)} ${endTime.weekday} ${endTimeStr}`;
        } else {
            // 同一天时间段：只显示一个日期
            formattedTime = `${startTime.year}-${padZero(startTime.month)}-${padZero(startTime.day)}`;

            // 添加星期信息（优先显示开始星期，如果跨日则显示两个星期）
            if (startTime.weekday) {
                if (startTime.weekday !== endTime.weekday) {
                    formattedTime += ` ${startTime.weekday}~${endTime.weekday}`;
                } else {
                    formattedTime += ` ${startTime.weekday}`;
                }
            }

            formattedTime += ` ${startTimeStr}~${endTimeStr}`;
        }

        return formattedTime;
    } else {
        // 时间点格式：YYYY-MM-DD HH:MM:SS
        const timeStr = formatTimeComponent(startTime);

        // 构建包含星期信息的时间字符串
        let formattedTime = `${startTime.year}-${padZero(startTime.month)}-${padZero(startTime.day)}`;

        // 添加星期信息
        if (startTime.weekday) {
            formattedTime += ` ${startTime.weekday}`;
        }

        formattedTime += ` ${timeStr}`;

        return formattedTime;
    }
}

/**
 * 使用标准时间数据补全目标时间数据的年、月、日信息
 * @param {Object} targetTimeData 需要补全的时间数据
 * @param {Object} standardTimeData 标准时间数据
 * @returns {Object} 补全后的时间数据
 */
export function completeTimeDataWithStandard(targetTimeData, standardTimeData) {
    if (!targetTimeData || !standardTimeData || !standardTimeData.isValid || !standardTimeData.startTime) {
        return targetTimeData;
    }

    // 检查是否需要补全日年月日信息
    const needsDateCompletion = targetTimeData.isComplete === false &&
        targetTimeData.startTime &&
        (!targetTimeData.startTime.year ||
            !targetTimeData.startTime.month ||
            !targetTimeData.startTime.day);

    // 检查是否需要补全时分秒信息（只有年月日的情况）
    const needsTimeCompletion = targetTimeData.isComplete === false &&
        targetTimeData.startTime &&
        targetTimeData.startTime.year &&
        targetTimeData.startTime.month &&
        targetTimeData.startTime.day &&
        (targetTimeData.startTime.hour === undefined || targetTimeData.startTime.minute === undefined);

    if (needsDateCompletion || needsTimeCompletion) {
        // 使用标准时间的年、月、日
        const standardYear = standardTimeData.startTime.year;
        const standardMonth = standardTimeData.startTime.month;
        const standardDay = standardTimeData.startTime.day;

        // 使用标准时间的时、分、秒
        const standardHour = standardTimeData.startTime.hour || 0;
        const standardMinute = standardTimeData.startTime.minute || 0;
        const standardSecond = standardTimeData.startTime.second || 0;

        // 补全日年月日信息
        if (needsDateCompletion) {
            targetTimeData.startTime.year = standardYear;
            targetTimeData.startTime.month = standardMonth;
            targetTimeData.startTime.day = standardDay;
            targetTimeData.startTime.hasDate = true;

            // 如果有结束时间，需要考虑跨日情况
            if (targetTimeData.isRange && targetTimeData.endTime) {
                // 计算targetTimeData原始的日期跨度（如果有）
                let daySpan = 0;

                // 检查原始targetTimeData是否已有日期跨度信息
                if (targetTimeData.endTime.year && targetTimeData.endTime.month && targetTimeData.endTime.day) {
                    // 计算原始日期跨度
                    const originalStart = new Date(
                        targetTimeData.startTime.year || standardYear,
                        (targetTimeData.startTime.month || standardMonth) - 1,
                        targetTimeData.startTime.day || standardDay
                    );
                    const originalEnd = new Date(
                        targetTimeData.endTime.year,
                        targetTimeData.endTime.month - 1,
                        targetTimeData.endTime.day
                    );
                    // 计算两个日期之间的天数差
                    daySpan = Math.floor((originalEnd - originalStart) / (1000 * 60 * 60 * 24));
                }
                // 如果标准时间有跨度，也可以参考
                else if (standardTimeData.isRange && standardTimeData.endTime &&
                    standardTimeData.endTime.year && standardTimeData.endTime.month && standardTimeData.endTime.day) {
                    // 计算标准时间的日期跨度
                    const standardStart = new Date(standardYear, standardMonth - 1, standardDay);
                    const standardEnd = new Date(
                        standardTimeData.endTime.year,
                        standardTimeData.endTime.month - 1,
                        standardTimeData.endTime.day
                    );
                    daySpan = Math.floor((standardEnd - standardStart) / (1000 * 60 * 60 * 24));
                }

                // 设置结束时间的日期，考虑跨度
                const endDate = new Date(standardYear, standardMonth - 1, standardDay);
                endDate.setDate(endDate.getDate() + daySpan);

                targetTimeData.endTime.year = endDate.getFullYear();
                targetTimeData.endTime.month = endDate.getMonth() + 1; // 月份从0开始，需要+1
                targetTimeData.endTime.day = endDate.getDate();
                targetTimeData.endTime.hasDate = true;
            }
        }

        // 补全时分秒信息（只有年月日的情况）
        if (needsTimeCompletion) {
            targetTimeData.startTime.hour = standardHour;
            targetTimeData.startTime.minute = standardMinute;
            targetTimeData.startTime.second = standardSecond;
            targetTimeData.startTime.hasTime = true;

            // 如果有结束时间，也补全时分秒，并考虑跨日情况
            if (targetTimeData.isRange && targetTimeData.endTime) {
                // 计算原始时间差（如果有）
                let timeDiffMs = 0;

                // 如果targetTimeData已有时间信息，计算时间差
                if (targetTimeData.startTime.hour !== undefined && targetTimeData.startTime.minute !== undefined &&
                    targetTimeData.endTime.hour !== undefined && targetTimeData.endTime.minute !== undefined) {
                    // 创建只包含时间的临时日期对象进行比较
                    const startTimeTemp = new Date(0, 0, 0,
                        targetTimeData.startTime.hour,
                        targetTimeData.startTime.minute,
                        targetTimeData.startTime.second || 0);
                    const endTimeTemp = new Date(0, 0, 0,
                        targetTimeData.endTime.hour,
                        targetTimeData.endTime.minute,
                        targetTimeData.endTime.second || 0);

                    // 计算时间差（毫秒）
                    timeDiffMs = endTimeTemp - startTimeTemp;

                    // 如果结束时间早于开始时间，说明跨日了，加上一天的毫秒数
                    if (timeDiffMs < 0) {
                        timeDiffMs += 24 * 60 * 60 * 1000;
                    }
                }
                // 如果标准时间有跨度，也可以参考标准时间的时间差
                else if (standardTimeData.isRange && standardTimeData.endTime &&
                    standardTimeData.startTime.hour !== undefined && standardTimeData.startTime.minute !== undefined &&
                    standardTimeData.endTime.hour !== undefined && standardTimeData.endTime.minute !== undefined) {
                    // 创建只包含标准时间的临时日期对象
                    const standardStartTimeTemp = new Date(0, 0, 0,
                        standardTimeData.startTime.hour,
                        standardTimeData.startTime.minute,
                        standardTimeData.startTime.second || 0);
                    const standardEndTimeTemp = new Date(0, 0, 0,
                        standardTimeData.endTime.hour,
                        standardTimeData.endTime.minute,
                        standardTimeData.endTime.second || 0);

                    // 计算标准时间差
                    timeDiffMs = standardEndTimeTemp - standardStartTimeTemp;

                    // 处理跨日情况
                    if (timeDiffMs < 0) {
                        timeDiffMs += 24 * 60 * 60 * 1000;
                    }
                }

                // 根据开始时间和时间差计算结束时间
                if (timeDiffMs > 0) {
                    // 使用补全后的开始时间作为基准
                    const startDateTime = new Date(
                        targetTimeData.startTime.year,
                        targetTimeData.startTime.month - 1,
                        targetTimeData.startTime.day,
                        targetTimeData.startTime.hour,
                        targetTimeData.startTime.minute,
                        targetTimeData.startTime.second
                    );

                    // 加上时间差得到结束时间
                    const endDateTime = new Date(startDateTime.getTime() + timeDiffMs);

                    targetTimeData.endTime.hour = endDateTime.getHours();
                    targetTimeData.endTime.minute = endDateTime.getMinutes();
                    targetTimeData.endTime.second = endDateTime.getSeconds();
                } else {
                    // 如果没有时间差信息，使用标准时间的结束时间或与开始时间相同
                    if (standardTimeData.isRange && standardTimeData.endTime) {
                        targetTimeData.endTime.hour = standardTimeData.endTime.hour || standardHour;
                        targetTimeData.endTime.minute = standardTimeData.endTime.minute || standardMinute;
                        targetTimeData.endTime.second = standardTimeData.endTime.second || standardSecond;
                    } else {
                        targetTimeData.endTime.hour = standardHour;
                        targetTimeData.endTime.minute = standardMinute;
                        targetTimeData.endTime.second = standardSecond;
                    }
                }

                targetTimeData.endTime.hasTime = true;
            }
        }

        // 重新计算时间戳（无论是否有原始时分秒，补全后都应计算）
        const date = new Date(
            targetTimeData.startTime.year,
            targetTimeData.startTime.month - 1,
            targetTimeData.startTime.day,
            targetTimeData.startTime.hour || 0,
            targetTimeData.startTime.minute || 0,
            targetTimeData.startTime.second || 0
        );
        targetTimeData.startTime.timestamp = date.getTime();

        // 如果是时间段，也重新计算结束时间的时间戳
        if (targetTimeData.isRange && targetTimeData.endTime) {
            const endDate = new Date(
                targetTimeData.endTime.year,
                targetTimeData.endTime.month - 1,
                targetTimeData.endTime.day,
                targetTimeData.endTime.hour || 0,
                targetTimeData.endTime.minute || 0,
                targetTimeData.endTime.second || 0
            );
            targetTimeData.endTime.timestamp = endDate.getTime();
        }

        // 更新isComplete状态
        targetTimeData.isComplete = true;

        // 使用formatTimeDataToStandard重新格式化时间字符串
        targetTimeData.formattedString = formatTimeDataToStandard(targetTimeData);
    }

    return targetTimeData;
}

/**
 * 测试函数 - 用于验证各种时间格式的解析
 */
export function testTimeParser() {
    const testCases = [
        '2023年09月25日 周一 17:35~17:40',
        '2023年09月28日 19:15',
        '2023-09-25 11:33',
        '2023-09-25/Sat 11:33',
        '2023-09-25 Sat 11:33',
        '2023-09-25/Saturday 11:33',
        '2023-09-25 Saturday 11:33',
        '24年4月11日 周四 08:23',
        '2023年09月30日 21:30',
        '11:33',
        '无效时间格式'
    ];

    console.log('=== 时间解析测试 ===');
    testCases.forEach(testCase => {
        const result = parseTimeDetailed(testCase);
        console.log(`输入: "${testCase}"`);
        console.log(`结果: ${formatTimeResult(result)}`);
        console.log(`详细信息:`, result);
        console.log('---');
    });
}

