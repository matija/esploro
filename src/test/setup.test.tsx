import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Smoke test for the test harness itself: jsdom environment, `globals: true`,
// React Testing Library rendering, and user-event interaction.
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>count: {count}</button>;
}

describe("test harness", () => {
  it("runs in a jsdom environment", () => {
    expect(typeof document).toBe("object");
  });

  it("renders components and handles user interaction", async () => {
    const user = userEvent.setup();
    render(<Counter />);

    const button = screen.getByRole("button", { name: "count: 0" });
    await user.click(button);

    expect(screen.getByRole("button", { name: "count: 1" })).toBeDefined();
  });
});
