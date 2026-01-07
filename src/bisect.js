/**
 * src/bisect.js
 * 按面积升序数组的二分查找辅助函数。
 */

/**
 * 在按 area 升序的数组中，找到第一个 area > maxArea 的位置（bisect_right）。
 * @param {Array<{area:number}>} arr 按面积升序排序的数组
 * @param {number} maxArea 最大面积阈值
 * @returns {number} 索引位置
 */
function bisectRightByArea(arr, maxArea) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].area <= maxArea) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 在数组中选出 area ≤ maxArea 的最大元素；不存在则返回 null。
 * @param {Array<{area:number}>} arr 按面积升序排序的数组
 * @param {number} maxArea 最大面积阈值
 * @returns {{area:number,type:string,srcFile:string}|null} 选中的元素或 null
 */
function pickBestUnderOrEqual(arr, maxArea) {
  const idx = bisectRightByArea(arr, maxArea) - 1;
  return idx >= 0 ? arr[idx] : null;
}

module.exports = {
  bisectRightByArea,
  pickBestUnderOrEqual,
};
