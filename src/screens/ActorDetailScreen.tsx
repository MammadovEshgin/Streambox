import { Feather } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { ScrollView } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import styled from "styled-components/native";

import { PersonDetails, getPersonDetails, getTmdbImageUrl } from "../api/tmdb";
import { MovieLoader } from "../components/common/MovieLoader";
import { MediaCard } from "../components/home/MediaCard";
import { HomeStackParamList } from "../navigation/types";

const Root = styled.View`
  flex: 1;
  background-color: ${({ theme }) => theme.colors.background};
`;

const ContentLayer = styled(Animated.View)`
  flex: 1;
`;

const LoaderWrap = styled.View`
  flex: 1;
  align-items: center;
  justify-content: center;
`;

const Header = styled.View`
  position: relative;
  height: 310px;
  overflow: hidden;
`;

const HeaderImagePressable = styled.Pressable`
  width: 100%;
  height: 100%;
`;

const HeaderImage = styled.Image`
  width: 100%;
  height: 100%;
`;

const HeaderShade = styled.View.attrs({
  pointerEvents: "none"
})`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(0, 0, 0, 0.32);
`;

const BackButton = styled.Pressable<{ $topOffset: number }>`
  position: absolute;
  top: ${({ $topOffset }) => $topOffset}px;
  left: 16px;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background-color: rgba(0, 0, 0, 0.45);
  align-items: center;
  justify-content: center;
`;

const Body = styled.View`
  margin-top: -26px;
  border-top-left-radius: 22px;
  border-top-right-radius: 22px;
  background-color: #000000;
  padding: 16px 16px 28px;
`;

const Name = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 26px;
  line-height: 31px;
  font-weight: 800;
  letter-spacing: -0.4px;
`;

const Meta = styled.Text`
  margin-top: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  line-height: 20px;
`;

const BioBlock = styled.View`
  margin-top: 14px;
`;

const BioLabel = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 19px;
  line-height: 24px;
  font-weight: 700;
  letter-spacing: -0.2px;
`;

const BioText = styled.Text`
  margin-top: 8px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 15px;
  line-height: 22px;
  text-align: justify;
`;

const ReadMoreButton = styled.Pressable`
  margin-top: 7px;
  align-self: flex-start;
`;

const ReadMoreText = styled.Text`
  color: ${({ theme }) => theme.colors.primary};
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
`;

const SectionHeader = styled.View`
  margin-top: 18px;
  margin-bottom: 10px;
  flex-direction: row;
  align-items: baseline;
  justify-content: flex-start;
`;

const SectionTitle = styled.Text`
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 21px;
  line-height: 26px;
  font-weight: 700;
  letter-spacing: -0.25px;
`;

const KnownForWrap = styled.View`
  height: 282px;
`;

const CardWrap = styled.View`
  margin-right: 12px;
`;

const ErrorText = styled.Text`
  margin-top: 10px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ImageOverlay = styled(Animated.View)`
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(0, 0, 0, 0.97);
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const ImageOverlayPress = styled.Pressable`
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
`;

const ImageModalContent = styled(Animated.View)`
  width: 100%;
  height: 78%;
  border-radius: 16px;
  overflow: hidden;
`;

const ImageModalPicture = styled.Image`
  width: 100%;
  height: 100%;
`;

type ActorDetailProps = NativeStackScreenProps<HomeStackParamList, "ActorDetail">;

function formatActorMeta(details: PersonDetails): string {
  const segments: string[] = [];

  if (details.knownForDepartment) {
    segments.push(details.knownForDepartment);
  }

  if (details.birthday) {
    const parsed = new Date(`${details.birthday}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      segments.push(parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }));
    }
  }

  if (details.placeOfBirth) {
    segments.push(details.placeOfBirth);
  }

  return segments.join("  |  ");
}

export function ActorDetailScreen({ route, navigation }: ActorDetailProps) {
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState<PersonDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBiographyExpanded, setIsBiographyExpanded] = useState(false);
  const [isImageViewerVisible, setIsImageViewerVisible] = useState(false);
  const overlayProgress = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const contentTranslateY = useSharedValue(24);
  const contentScale = useSharedValue(0.92);
  const pageParallax = useSharedValue(0);

  const loadActor = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await getPersonDetails(route.params.actorId);
      setDetails(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load actor profile.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [route.params.actorId]);

  useEffect(() => {
    void loadActor();
  }, [loadActor]);

  const headerImage = details ? getTmdbImageUrl(details.profilePath, "w780") : null;

  const openImageViewer = useCallback(() => {
    if (!headerImage) {
      return;
    }

    overlayProgress.value = 0;
    contentOpacity.value = 0;
    contentTranslateY.value = 24;
    contentScale.value = 0.92;
    pageParallax.value = 0;
    setIsImageViewerVisible(true);
    overlayProgress.value = withTiming(1, {
      duration: 560,
      easing: Easing.bezier(0.22, 1, 0.36, 1)
    });
    contentOpacity.value = withTiming(1, {
      duration: 420,
      easing: Easing.out(Easing.quad)
    });
    contentTranslateY.value = withTiming(0, {
      duration: 560,
      easing: Easing.bezier(0.16, 1, 0.3, 1)
    });
    contentScale.value = withSpring(1, {
      damping: 17,
      stiffness: 105,
      mass: 1.05
    });
    pageParallax.value = withTiming(1, {
      duration: 520,
      easing: Easing.out(Easing.cubic)
    });
  }, [headerImage, overlayProgress]);

  const hideImageViewer = useCallback(() => {
    setIsImageViewerVisible(false);
  }, []);

  const closeImageViewer = useCallback(() => {
    contentOpacity.value = withTiming(0, {
      duration: 230,
      easing: Easing.out(Easing.quad)
    });
    contentTranslateY.value = withTiming(16, {
      duration: 300,
      easing: Easing.inOut(Easing.cubic)
    });
    contentScale.value = withTiming(0.96, {
      duration: 300,
      easing: Easing.inOut(Easing.cubic)
    });
    pageParallax.value = withTiming(0, {
      duration: 330,
      easing: Easing.inOut(Easing.cubic)
    });
    overlayProgress.value = withTiming(
      0,
      {
        duration: 360,
        easing: Easing.inOut(Easing.cubic)
      },
      (finished) => {
        if (finished) {
          runOnJS(hideImageViewer)();
        }
      }
    );
  }, [contentOpacity, contentScale, contentTranslateY, hideImageViewer, overlayProgress, pageParallax]);

  const overlayAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(overlayProgress.value, [0, 1], [0, 1]),
      backgroundColor: interpolateColor(overlayProgress.value, [0, 1], ["rgba(0,0,0,0)", "rgba(0,0,0,0.98)"])
    };
  });

  const modalContentAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: contentOpacity.value,
      transform: [
        {
          scale: contentScale.value
        },
        {
          translateY: contentTranslateY.value
        }
      ]
    };
  });

  const contentLayerAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(pageParallax.value, [0, 1], [1, 0.86]),
      transform: [
        {
          scale: interpolate(pageParallax.value, [0, 1], [1, 0.985])
        },
        {
          translateY: interpolate(pageParallax.value, [0, 1], [0, 8])
        }
      ]
    };
  });

  if (isLoading && !details) {
    return (
      <Root>
        <LoaderWrap>
          <MovieLoader label="Loading profile" />
        </LoaderWrap>
      </Root>
    );
  }

  if (!details) {
    return (
      <Root>
        <Header>
          <BackButton onPress={() => navigation.goBack()} $topOffset={insets.top + 8}>
            <Feather name="arrow-left" size={18} color="#FFFFFF" />
          </BackButton>
        </Header>
        <Body>
          <ErrorText>{errorMessage ?? "No actor data available."}</ErrorText>
        </Body>
      </Root>
    );
  }

  const actorMeta = formatActorMeta(details);
  const fullBiography =
    details.biography ||
    "Biography data is not available for this actor yet. This profile will be expanded in the next phase.";
  const biographyPreview =
    isBiographyExpanded || fullBiography.length <= 230
      ? fullBiography
      : `${fullBiography.slice(0, 230).trimEnd()}...`;
  const canExpandBiography = fullBiography.length > 230;

  return (
    <Root>
      <ContentLayer style={contentLayerAnimatedStyle}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Header>
            <HeaderImagePressable onPress={openImageViewer}>
              {headerImage ? <HeaderImage source={{ uri: headerImage }} resizeMode="cover" /> : null}
            </HeaderImagePressable>
            <HeaderShade />
            <BackButton onPress={() => navigation.goBack()} $topOffset={insets.top + 8}>
              <Feather name="arrow-left" size={18} color="#FFFFFF" />
            </BackButton>
          </Header>

          <Body>
            <Animated.View entering={FadeInDown.duration(380).delay(70)}>
              <Name>{details.name}</Name>
              {actorMeta ? <Meta>{actorMeta}</Meta> : null}
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(380).delay(120)}>
              <BioBlock>
                <BioLabel>Biography</BioLabel>
                <BioText>{biographyPreview}</BioText>
                {canExpandBiography ? (
                  <ReadMoreButton
                    onPress={() => {
                      setIsBiographyExpanded((previous) => !previous);
                    }}
                  >
                    <ReadMoreText>{isBiographyExpanded ? "Read less" : "Read more"}</ReadMoreText>
                  </ReadMoreButton>
                ) : null}
              </BioBlock>
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(380).delay(160)}>
              <SectionHeader>
                <SectionTitle>Known For</SectionTitle>
              </SectionHeader>
              <KnownForWrap>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {details.knownForMovies.map((item) => (
                    <CardWrap key={item.id}>
                      <MediaCard
                        item={item}
                        onPress={() => {
                          navigation.push("MovieDetail", { movieId: String(item.id) });
                        }}
                      />
                    </CardWrap>
                  ))}
                </ScrollView>
              </KnownForWrap>
            </Animated.View>
          </Body>
        </ScrollView>
      </ContentLayer>
      {isImageViewerVisible ? (
        <ImageOverlay style={overlayAnimatedStyle}>
          <ImageOverlayPress onPress={closeImageViewer}>
            <ImageModalContent style={modalContentAnimatedStyle}>
              {headerImage ? <ImageModalPicture source={{ uri: headerImage }} resizeMode="contain" /> : null}
            </ImageModalContent>
          </ImageOverlayPress>
        </ImageOverlay>
      ) : null}
    </Root>
  );
}
