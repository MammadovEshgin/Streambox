# Global Project Configuration: StreamBox

## 1. Tech Stack
- **Framework:** React Native + Expo (Testing via Expo Go)
- **Styling:** styled-components
- **Navigation:** React Navigation (Bottom Tabs Only)
- **Animations:** React Native Reanimated
- **Data:** Axios + TMDB API

## 2. Clean Code Principles
- **S.O.L.I.D:** Each component/function does one thing.
- **DRY:** Extract repeated UI patterns into `src/components/common`.
- **KISS:** Keep the UI simple. No nested menus. No signup.
- **Composition:** Prefer functional components and Hooks.

## 3. Automatic Agent Assignment
- If task contains "UI", "CSS", "Color", "Icon" -> **Assign: @designer**
- If task contains "API", "Logic", "Stream", "Player" -> **Assign: @backend_dev**
- If task contains "Fix", "Error", "Test", "Bug" -> **Assign: @qa_engineer**
- If task contains "Plan", "Review", "Phase", "Next" -> **Assign: @orchester**

## 4. Execution Workflow
1. **Orchester** defines the task.
2. **Designer** provides the visual spec/styled-components.
3. **Backend_Dev** implements the logic and data flow.
4. **QA_Engineer** runs the "checklist" and confirms stability.
5. **Orchester** gives the final "Go" for the next phase.