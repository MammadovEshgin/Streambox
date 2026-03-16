import styled from "styled-components/native";

const Pill = styled.View`
  padding: 5px 10px;
  border-radius: 3px;
  background-color: rgba(35, 35, 35, 0.92);
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.08);
  margin-right: 6px;
  flex-shrink: 1;
`;

const Label = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 11px;
  line-height: 15px;
  font-weight: 600;
  letter-spacing: 0.25px;
  text-transform: uppercase;
`;

type MetaPillProps = {
  label: string;
};

export function MetaPill({ label }: MetaPillProps) {
  return (
    <Pill>
      <Label numberOfLines={1}>{label}</Label>
    </Pill>
  );
}
