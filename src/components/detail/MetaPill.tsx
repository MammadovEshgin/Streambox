import styled from "styled-components/native";

const Pill = styled.View`
  padding: 5px 11px;
  border-radius: 999px;
  background-color: ${({ theme }) => theme.colors.glassFill};
  border-width: 1px;
  border-color: ${({ theme }) => theme.colors.glassBorder};
  margin-right: 6px;
  flex-shrink: 1;
`;

const Label = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: Outfit_600SemiBold;
  font-size: 10px;
  line-height: 14px;
  letter-spacing: 0.8px;
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
