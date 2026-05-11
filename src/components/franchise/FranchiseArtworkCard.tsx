import { memo } from "react";
import styled from "styled-components/native";

import { franchiseCardBackgroundImage } from "../../constants/imageAssets";

type FranchiseCollectionArtworkProps = {
  title: string;
  accentColor?: string | null;
  compact?: boolean;
};

const ArtworkFrame = styled.View`
  flex: 1;
  overflow: hidden;
  background-color: #0b0d12;
`;

const PosterImage = styled.Image`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
`;

function FranchiseCollectionArtworkComponent(_props: FranchiseCollectionArtworkProps) {
  return (
    <ArtworkFrame>
      <PosterImage source={franchiseCardBackgroundImage} resizeMode="cover" />
    </ArtworkFrame>
  );
}

export const FranchiseCollectionArtwork = memo(FranchiseCollectionArtworkComponent);
