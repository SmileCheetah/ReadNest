const React = require("react");
const { act, create } = require("react-test-renderer");
const { BottomNav } = require("./BottomNav");
jest.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));

it.each(["home", "archive", "explore", "settings"])(
  "keeps four independent tabs with only %s selected",
  async (current) => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    const onChange = jest.fn();
    let tree;
    await act(async () => {
      tree = create(React.createElement(BottomNav, { current, onChange }));
    });
    const matches = tree.root.findAll(
      (node) =>
        node.props.accessibilityRole === "tab" &&
        typeof node.props.onPress === "function",
    );
    const tabs = [
      ...new Map(
        matches.map((node) => [node.props.accessibilityLabel, node]),
      ).values(),
    ];
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      "홈",
      "보관함",
      "탐색",
      "설정",
    ]);
    const keys = ["home", "archive", "explore", "settings"];
    expect(tabs.map((tab) => tab.props.accessibilityState.selected)).toEqual(
      keys.map((key) => key === current),
    );
    for (let i = 0; i < tabs.length; i++) {
      await act(async () => tabs[i].props.onPress());
      expect(onChange).toHaveBeenLastCalledWith(keys[i]);
    }
    await act(async () => tree.unmount());
  },
);
