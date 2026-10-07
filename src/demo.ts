import { TreeInput } from "./model";

/** 已知示例：根 R 有三个孩子 A（在世）、B（已故，有 B1/B2 在世）、C（已故无后代）。 */
export function demoTreeV1(): TreeInput {
  return {
    rootId: "R",
    persons: [
      { id: "R", name: "根 R（份额来源）", parentId: null, alive: false },
      { id: "A", name: "A", parentId: "R", alive: true },
      { id: "B", name: "B", parentId: "R", alive: false },
      { id: "B1", name: "B1", parentId: "B", alive: true },
      { id: "B2", name: "B2", parentId: "B", alive: true },
      { id: "C", name: "C", parentId: "R", alive: false },
      { id: "C1", name: "C1", parentId: "C", alive: false },
    ],
  };
}

/** 演示第二版：A 改为已故，A 的两个在世孩子 A1、A2 在 A 支系内部代位。 */
export function demoTreeV2(): TreeInput {
  return {
    rootId: "R",
    persons: [
      { id: "R", name: "根 R（份额来源）", parentId: null, alive: false },
      { id: "A", name: "A", parentId: "R", alive: false },
      { id: "A1", name: "A1", parentId: "A", alive: true },
      { id: "A2", name: "A2", parentId: "A", alive: true },
      { id: "B", name: "B", parentId: "R", alive: false },
      { id: "B1", name: "B1", parentId: "B", alive: true },
      { id: "B2", name: "B2", parentId: "B", alive: true },
      { id: "C", name: "C", parentId: "R", alive: false },
      { id: "C1", name: "C1", parentId: "C", alive: false },
    ],
  };
}
