// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Parser, Node} from 'commonmark';
import Renderer from 'commonmark-react-renderer';
import React, {ReactElement, useRef} from 'react';
import {Dimensions, GestureResponderEvent, Platform, StyleProp, Text, TextStyle, View} from 'react-native';

import Emoji from '@components/emoji';
import FormattedText from '@components/formatted_text';
import Hashtag from '@components/markdown/hashtag';
import {blendColors, concatStyles, makeStyleSheetFromTheme} from '@utils/theme';
import {getScheme} from '@utils/url';

import AtMention from './at_mention';
import ChannelMention, {ChannelMentions} from './channel_mention';
import MarkdownBlockQuote from './markdown_block_quote';
import MarkdownCodeBlock from './markdown_code_block';
import MarkdownImage from './markdown_image';
import MarkdownLatexCodeBlock from './markdown_latex_block';
import MarkdownLatexInline from './markdown_latex_inline';
import MarkdownLink from './markdown_link';
import MarkdownList from './markdown_list';
import MarkdownListItem from './markdown_list_item';
import MarkdownTable from './markdown_table';
import MarkdownTableCell, {MarkdownTableCellProps} from './markdown_table_cell';
import MarkdownTableImage from './markdown_table_image';
import MarkdownTableRow, {MarkdownTableRowProps} from './markdown_table_row';
import {addListItemIndices, combineTextNodes, highlightMentions, pullOutImages} from './transform';

import type {
    MarkdownAtMentionRenderer, MarkdownBaseRenderer, MarkdownBlockStyles, MarkdownChannelMentionRenderer,
    MarkdownEmojiRenderer, MarkdownImageRenderer, MarkdownLatexRenderer, MarkdownTextStyles, UserMentionKey,
} from '@typings/global/markdown';

type MarkdownProps = {
    autolinkedUrlSchemes?: string[];
    baseTextStyle: StyleProp<TextStyle>;
    blockStyles?: MarkdownBlockStyles;
    channelMentions?: ChannelMentions;
    disableAtChannelMentionHighlight?: boolean;
    disableAtMentions?: boolean;
    disableChannelLink?: boolean;
    disableGallery?: boolean;
    disableHashtags?: boolean;
    enableLatex: boolean;
    enableInlineLatex: boolean;
    imagesMetadata?: Record<string, PostImage>;
    isEdited?: boolean;
    isReplyPost?: boolean;
    isSearchResult?: boolean;
    layoutWidth?: number;
    location?: string;
    mentionKeys?: UserMentionKey[];
    minimumHashtagLength?: number;
    onPostPress?: (event: GestureResponderEvent) => void;
    postId?: string;
    textStyles?: MarkdownTextStyles;
    theme: Theme;
    value?: string | number;
}

const getStyleSheet = makeStyleSheetFromTheme((theme) => {
    // Android has trouble giving text transparency depending on how it's nested,
    // so we calculate the resulting colour manually
    const editedOpacity = Platform.select({
        ios: 0.3,
        android: 1.0,
    });
    const editedColor = Platform.select({
        ios: theme.centerChannelColor,
        android: blendColors(theme.centerChannelBg, theme.centerChannelColor, 0.3),
    });

    return {
        block: {
            alignItems: 'flex-start',
            flexDirection: 'row',
            flexWrap: 'wrap',
        },
        editedIndicatorText: {
            color: editedColor,
            opacity: editedOpacity,
        },
        atMentionOpacity: {
            opacity: 1,
        },
    };
});

const getExtraPropsForNode = (node: any) => {
    const extraProps: Record<string, any> = {
        continue: node.continue,
        index: node.index,
    };

    if (node.type === 'image') {
        extraProps.reactChildren = node.react.children;
        extraProps.linkDestination = node.linkDestination;
        extraProps.size = node.size;
    }

    return extraProps;
};

const computeTextStyle = (textStyles: MarkdownTextStyles, baseStyle: StyleProp<TextStyle>, context: any) => {
    type TextType = keyof typeof textStyles;
    const contextStyles: TextStyle[] = context.map((type: any) => textStyles[type as TextType]).filter((f: any) => f !== undefined);
    return contextStyles.length ? concatStyles(baseStyle, contextStyles) : baseStyle;
};

const Markdown = ({
    autolinkedUrlSchemes, baseTextStyle, blockStyles, channelMentions,
    disableAtChannelMentionHighlight = false, disableAtMentions = false, disableChannelLink = false,
    disableGallery = false, disableHashtags = false, enableInlineLatex, enableLatex,
    imagesMetadata, isEdited, isReplyPost, isSearchResult, layoutWidth,
    location, mentionKeys, minimumHashtagLength = 3, onPostPress, postId,
    textStyles = {}, theme, value = '',
}: MarkdownProps) => {
    const style = getStyleSheet(theme);

    const urlFilter = (url: string) => {
        const scheme = getScheme(url);
        return !scheme || autolinkedUrlSchemes?.indexOf(scheme) !== -1;
    };

    const renderAtMention = ({context, mentionName}: MarkdownAtMentionRenderer) => {
        if (disableAtMentions) {
            return renderText({context, literal: `@${mentionName}`});
        }

        return (
            <AtMention
                disableAtChannelMentionHighlight={disableAtChannelMentionHighlight}
                mentionStyle={textStyles.mention}
                textStyle={[computeTextStyle(textStyles, baseTextStyle, context), style.atMentionOpacity]}
                isSearchResult={isSearchResult}
                mentionName={mentionName}
                onPostPress={onPostPress}
                mentionKeys={mentionKeys}
            />
        );
    };

    const renderBlockQuote = ({children, ...otherProps}: any) => {
        return (
            <MarkdownBlockQuote
                iconStyle={blockStyles?.quoteBlockIcon}
                {...otherProps}
            >
                {children}
            </MarkdownBlockQuote>
        );
    };

    const renderBreak = () => {
        return <Text>{'\n'}</Text>;
    };

    const renderChannelLink = ({context, channelName}: MarkdownChannelMentionRenderer) => {
        if (disableChannelLink) {
            return renderText({context, literal: `~${channelName}`});
        }

        return (
            <ChannelMention
                linkStyle={textStyles.link}
                textStyle={computeTextStyle(textStyles, baseTextStyle, context)}
                channelName={channelName}
                channelMentions={channelMentions}
            />
        );
    };

    const renderCodeBlock = (props: any) => {
        // These sometimes include a trailing newline
        const content = props.literal.replace(/\n$/, '');

        if (enableLatex && props.language === 'latex') {
            return (
                <MarkdownLatexCodeBlock
                    content={content}
                    theme={theme}
                />
            );
        }

        return (
            <MarkdownCodeBlock
                content={content}
                language={props.language}
                textStyle={textStyles.codeBlock}
            />
        );
    };

    const renderCodeSpan = ({context, literal}: MarkdownBaseRenderer) => {
        const {code} = textStyles;
        return <Text style={computeTextStyle(textStyles, [baseTextStyle, code], context)}>{literal}</Text>;
    };

    const renderEditedIndicator = ({context}: {context: string[]}) => {
        let spacer = '';
        const styles = [baseTextStyle, style.editedIndicatorText];

        if (context[0] === 'paragraph') {
            spacer = ' ';
        }

        return (
            <Text
                style={styles}
                testID='edited_indicator'
            >
                {spacer}
                <FormattedText
                    id='post_message_view.edited'
                    defaultMessage='(edited)'
                />
            </Text>
        );
    };

    const renderEmoji = ({context, emojiName, literal}: MarkdownEmojiRenderer) => {
        return (
            <Emoji
                emojiName={emojiName}
                literal={literal}
                testID='markdown_emoji'
                textStyle={computeTextStyle(textStyles, baseTextStyle, context)}
            />
        );
    };

    const renderHashtag = ({context, hashtag}: {context: string[]; hashtag: string}) => {
        if (disableHashtags) {
            return renderText({context, literal: `#${hashtag}`});
        }

        return (
            <Hashtag
                hashtag={hashtag}
                linkStyle={textStyles.link}
            />
        );
    };

    const renderHeading = ({children, level}: {children: ReactElement; level: string}) => {
        const containerStyle = [
            style.block,
            textStyles[`heading${level}`],
        ];
        const textStyle = textStyles[`heading${level}Text`];
        return (
            <View style={containerStyle}>
                <Text style={textStyle}>
                    {children}
                </Text>
            </View>
        );
    };

    const renderHtml = (props: any) => {
        let rendered = renderText(props);

        if (props.isBlock) {
            rendered = (
                <View style={style.block}>
                    {rendered}
                </View>
            );
        }

        return rendered;
    };

    const renderImage = ({linkDestination, context, src, size}: MarkdownImageRenderer) => {
        if (!imagesMetadata) {
            return null;
        }

        if (context.indexOf('table') !== -1) {
            // We have enough problems rendering images as is, so just render a link inside of a table
            return (
                <MarkdownTableImage
                    disabled={disableGallery ?? Boolean(!location)}
                    imagesMetadata={imagesMetadata}
                    location={location}
                    postId={postId!}
                    source={src}
                />
            );
        }

        return (
            <MarkdownImage
                disabled={disableGallery ?? Boolean(!location)}
                errorTextStyle={[computeTextStyle(textStyles, baseTextStyle, context), textStyles.error]}
                layoutWidth={layoutWidth}
                linkDestination={linkDestination}
                imagesMetadata={imagesMetadata}
                isReplyPost={isReplyPost}
                location={location}
                postId={postId!}
                source={src}
                sourceSize={size}
            />
        );
    };

    const renderLatexInline = ({context, latexCode}: MarkdownLatexRenderer) => {
        if (!enableInlineLatex) {
            return renderText({context, literal: `$${latexCode}$`});
        }

        return (
            <Text>
                <MarkdownLatexInline
                    content={latexCode}
                    maxMathWidth={Dimensions.get('window').width * 0.75}
                    theme={theme}
                />
            </Text>
        );
    };

    const renderLink = ({children, href}: {children: ReactElement; href: string}) => {
        return (
            <MarkdownLink href={href}>
                {children}
            </MarkdownLink>
        );
    };

    const renderList = ({children, start, tight, type}: any) => {
        return (
            <MarkdownList
                ordered={type !== 'bullet'}
                start={start}
                tight={tight}
            >
                {children}
            </MarkdownList>
        );
    };

    const renderListItem = ({children, context, ...otherProps}: any) => {
        const level = context.filter((type: string) => type === 'list').length;

        return (
            <MarkdownListItem
                bulletStyle={baseTextStyle}
                level={level}
                {...otherProps}
            >
                {children}
            </MarkdownListItem>
        );
    };

    const renderParagraph = ({children, first}: {children: ReactElement[]; first: boolean}) => {
        if (!children || children.length === 0) {
            return null;
        }

        const blockStyle = [style.block];
        if (!first) {
            blockStyle.push(blockStyles?.adjacentParagraph);
        }

        return (
            <View style={blockStyle}>
                <Text>
                    {children}
                </Text>
            </View>
        );
    };

    const renderTable = ({children, numColumns}: {children: ReactElement; numColumns: number}) => {
        return (
            <MarkdownTable
                numColumns={numColumns}
                theme={theme}
            >
                {children}
            </MarkdownTable>
        );
    };

    const renderTableCell = (args: MarkdownTableCellProps) => {
        return <MarkdownTableCell {...args}/>;
    };

    const renderTableRow = (args: MarkdownTableRowProps) => {
        return <MarkdownTableRow {...args}/>;
    };

    const renderText = ({context, literal}: MarkdownBaseRenderer) => {
        if (context.indexOf('image') !== -1) {
            // If this text is displayed, it will be styled by the image component
            return (
                <Text testID='markdown_text'>
                    {literal}
                </Text>
            );
        }

        // Construct the text style based off of the parents of this node since RN's inheritance is limited
        const styles = computeTextStyle(textStyles, baseTextStyle, context);

        return (
            <Text
                testID='markdown_text'
                style={styles}
            >
                {literal}
            </Text>
        );
    };

    const renderThematicBreak = () => {
        return (
            <View
                style={blockStyles?.horizontalRule}
                testID='markdown_thematic_break'
            />
        );
    };

    const createRenderer = () => {
        const renderers: any = {
            text: renderText,

            emph: Renderer.forwardChildren,
            strong: Renderer.forwardChildren,
            del: Renderer.forwardChildren,
            code: renderCodeSpan,
            link: renderLink,
            image: renderImage,
            atMention: renderAtMention,
            channelLink: renderChannelLink,
            emoji: renderEmoji,
            hashtag: renderHashtag,
            latexinline: renderLatexInline,

            paragraph: renderParagraph,
            heading: renderHeading,
            codeBlock: renderCodeBlock,
            blockQuote: renderBlockQuote,

            list: renderList,
            item: renderListItem,

            hardBreak: renderBreak,
            thematicBreak: renderThematicBreak,
            softBreak: renderBreak,

            htmlBlock: renderHtml,
            htmlInline: renderHtml,

            table: renderTable,
            table_row: renderTableRow,
            table_cell: renderTableCell,

            mention_highlight: Renderer.forwardChildren,

            editedIndicator: renderEditedIndicator,
        };

        return new Renderer({
            renderers,
            renderParagraphsInLists: true,
            getExtraPropsForNode,
        });
    };

    const parser = useRef(new Parser({urlFilter, minimumHashtagLength})).current;
    const renderer = useRef(createRenderer()).current;
    let ast = parser.parse(value.toString());

    ast = combineTextNodes(ast);
    ast = addListItemIndices(ast);
    ast = pullOutImages(ast);
    if (mentionKeys) {
        ast = highlightMentions(ast, mentionKeys);
    }

    if (isEdited) {
        const editIndicatorNode = new Node('edited_indicator');
        if (ast.lastChild && ['heading', 'paragraph'].includes(ast.lastChild.type)) {
            ast.appendChild(editIndicatorNode);
        } else {
            const node = new Node('paragraph');
            node.appendChild(editIndicatorNode);

            ast.appendChild(node);
        }
    }

    return renderer.render(ast) as JSX.Element;
};

export default Markdown;