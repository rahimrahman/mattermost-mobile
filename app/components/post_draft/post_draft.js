// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';
import {Alert, Platform, ScrollView, View} from 'react-native';
import {intlShape} from 'react-intl';
import RNFetchBlob from 'rn-fetch-blob';

import Autocomplete from '@components/autocomplete';
import {paddingHorizontal as padding} from '@components/safe_area_view/iphone_x_spacing';
import {CHANNEL_POST_TEXTBOX_CURSOR_CHANGE, CHANNEL_POST_TEXTBOX_VALUE_CHANGE, IS_REACTION_REGEX, MAX_FILE_COUNT} from '@constants/post_draft';
import {NOTIFY_ALL_MEMBERS} from '@constants/view';
import {AT_MENTION_REGEX_GLOBAL, CODE_REGEX} from 'app/constants/autocomplete';
import {General} from '@mm-redux/constants';
import EventEmitter from '@mm-redux/utils/event_emitter';
import {getFormattedFileSize} from '@mm-redux/utils/file_utils';
import EphemeralStore from '@store/ephemeral_store';
import {confirmOutOfOfficeDisabled} from '@utils/status';
import {changeOpacity, makeStyleSheetFromTheme} from '@utils/theme';

import Archived from './archived';
import PostInput from './post_input';
import QuickActions from './quick_actions';
import Typing from './typing';
import Uploads from './uploads';

const AUTOCOMPLETE_MARGIN = 20;
const AUTOCOMPLETE_MAX_HEIGHT = 200;

export default class PostDraft extends PureComponent {
    static propTypes = {
        registerTypingAnimation: PropTypes.func.isRequired,
        addReactionToLatestPost: PropTypes.func.isRequired,
        getChannelMemberCountsByGroup: PropTypes.func.isRequired,
        canPost: PropTypes.bool.isRequired,
        channelDisplayName: PropTypes.string,
        channelId: PropTypes.string.isRequired,
        channelIsArchived: PropTypes.bool,
        channelIsReadOnly: PropTypes.bool.isRequired,
        createPost: PropTypes.func.isRequired,
        currentUserId: PropTypes.string.isRequired,
        cursorPositionEvent: PropTypes.string,
        deactivatedChannel: PropTypes.bool.isRequired,
        enableConfirmNotificationsToChannel: PropTypes.bool,
        executeCommand: PropTypes.func.isRequired,
        files: PropTypes.array,
        getChannelTimezones: PropTypes.func.isRequired,
        handleClearFiles: PropTypes.func.isRequired,
        handleClearFailedFiles: PropTypes.func.isRequired,
        initUploadFiles: PropTypes.func.isRequired,
        isLandscape: PropTypes.bool.isRequired,
        isTimezoneEnabled: PropTypes.bool,
        maxMessageLength: PropTypes.number.isRequired,
        maxFileSize: PropTypes.number.isRequired,
        membersCount: PropTypes.number,
        rootId: PropTypes.string,
        screenId: PropTypes.string.isRequired,
        setStatus: PropTypes.func.isRequired,
        theme: PropTypes.object.isRequired,
        useChannelMentions: PropTypes.bool.isRequired,
        userIsOutOfOffice: PropTypes.bool.isRequired,
        value: PropTypes.string.isRequired,
        valueEvent: PropTypes.string,
        useGroupMentions: PropTypes.bool.isRequired,
        channelMemberCountsByGroup: PropTypes.object,
        groupsWithAllowReference: PropTypes.object,
    };

    static defaultProps = {
        canPost: true,
        cursorPositionEvent: CHANNEL_POST_TEXTBOX_CURSOR_CHANGE,
        files: [],
        rootId: '',
        value: '',
        valueEvent: CHANNEL_POST_TEXTBOX_VALUE_CHANGE,
    };

    static contextTypes = {
        intl: intlShape,
    };

    constructor(props) {
        super(props);

        this.input = React.createRef();

        this.state = {
            top: 0,
            value: props.value,
            rootId: props.rootId,
            channelId: props.channelId,
            channelTimezoneCount: 0,
        };
    }

    componentDidMount() {
        const {getChannelMemberCountsByGroup, channelId, isTimezoneEnabled, useGroupMentions} = this.props;
        if (useGroupMentions) {
            getChannelMemberCountsByGroup(channelId, isTimezoneEnabled);
        }
    }

    componentDidUpdate(prevProps) {
        const {channelId, rootId, value, useGroupMentions, getChannelMemberCountsByGroup, isTimezoneEnabled} = this.props;
        const diffChannel = channelId !== prevProps?.channelId;
        const diffTimezoneEnabled = isTimezoneEnabled !== prevProps?.isTimezoneEnabled;

        if (this.input.current) {
            const diffThread = rootId !== prevProps.rootId;
            if (diffChannel || diffThread) {
                const trimmed = value.trim();
                this.input.current.setValue(trimmed);
                this.updateInitialValue(trimmed);
            }
        }

        if (diffTimezoneEnabled || diffChannel) {
            this.numberOfTimezones().then((channelTimezoneCount) => this.setState({channelTimezoneCount}));
            if (useGroupMentions) {
                getChannelMemberCountsByGroup(channelId, isTimezoneEnabled);
            }
        }
    }

    blurTextBox = () => {
        if (this.input.current) {
            this.input.current.blur();
        }
    }

    canSend = () => {
        const {files, maxMessageLength} = this.props;
        const value = this.input.current?.getValue() || '';
        const messageLength = value.trim().length;

        if (messageLength > maxMessageLength) {
            return false;
        }

        if (files.length) {
            const loadingComplete = !this.isFileLoading();
            return loadingComplete;
        }

        return messageLength > 0;
    };

    showSendToGroupsAlert = (groupMentions, memberNotifyCount, channelTimezoneCount, msg) => {
        const {intl} = this.context;

        let notifyAllMessage = '';
        if (groupMentions.length === 1) {
            if (channelTimezoneCount > 0) {
                notifyAllMessage = (
                    intl.formatMessage(
                        {
                            id: 'mobile.post_textbox.one_group.message.with_timezones',
                            defaultMessage: 'By using {mention} you are about to send notifications to {totalMembers} people in {timezones, number} {timezones, plural, one {timezone} other {timezones}}. Are you sure you want to do this?',
                        },
                        {
                            mention: groupMentions[0],
                            totalMembers: memberNotifyCount,
                            timezones: channelTimezoneCount,
                        },
                    )
                );
            } else {
                notifyAllMessage = (
                    intl.formatMessage(
                        {
                            id: 'mobile.post_textbox.one_group.message.without_timezones',
                            defaultMessage: 'By using {mention} you are about to send notifications to {totalMembers} people. Are you sure you want to do this?',
                        },
                        {
                            mention: groupMentions[0],
                            totalMembers: memberNotifyCount,
                        },
                    )
                );
            }
        } else if (channelTimezoneCount > 0) {
            notifyAllMessage = (
                intl.formatMessage(
                    {
                        id: 'mobile.post_textbox.multi_group.message.with_timezones',
                        defaultMessage: 'By using {mentions} and {finalMention} you are about to send notifications to at least {totalMembers} people in {timezones, number} {timezones, plural, one {timezone} other {timezones}}. Are you sure you want to do this?',
                    },
                    {
                        mentions: groupMentions.slice(0, -1).join(', '),
                        finalMention: groupMentions[groupMentions.length - 1],
                        totalMembers: memberNotifyCount,
                        timezones: channelTimezoneCount,
                    },
                )
            );
        } else {
            notifyAllMessage = (
                intl.formatMessage(
                    {
                        id: 'mobile.post_textbox.multi_group.message.without_timezones',
                        defaultMessage: 'By using {mentions} and {finalMention} you are about to send notifications to at least {totalMembers} people. Are you sure you want to do this?',
                    },
                    {
                        mentions: groupMentions.slice(0, -1).join(', '),
                        finalMention: groupMentions[groupMentions.length - 1],
                        totalMembers: memberNotifyCount,
                    },
                )
            );
        }

        Alert.alert(
            intl.formatMessage({
                id: 'mobile.post_textbox.groups.title',
                defaultMessage: 'Confirm sending notifications to groups',
            }),
            notifyAllMessage,
            [
                {
                    text: intl.formatMessage({
                        id: 'mobile.post_textbox.entire_channel.cancel',
                        defaultMessage: 'Cancel',
                    }),
                    onPress: () => {
                        this.input.current.setValue(msg);
                        this.setState({sendingMessage: false});
                    },
                },
                {
                    text: intl.formatMessage({
                        id: 'mobile.post_textbox.entire_channel.confirm',
                        defaultMessage: 'Confirm',
                    }),
                    onPress: () => this.doSubmitMessage(),
                },
            ],
        );
    };

    doSubmitMessage = () => {
        const {createPost, currentUserId, channelId, files, handleClearFiles, rootId} = this.props;
        const value = this.input.current.getValue();
        const postFiles = files.filter((f) => !f.failed);
        const post = {
            user_id: currentUserId,
            channel_id: channelId,
            root_id: rootId,
            parent_id: rootId,
            message: value,
        };

        createPost(post, postFiles);

        if (postFiles.length) {
            handleClearFiles(channelId, rootId);
        }

        this.input.current.setValue('');
        this.setState({sendingMessage: false});

        this.input.current.changeDraft('');

        if (Platform.OS === 'android') {
            // Fixes the issue where Android predictive text would prepend suggestions to the post draft when messages
            // are typed successively without blurring the input
            const nextState = {
                keyboardType: 'email-address',
            };

            const callback = () => this.setState({keyboardType: 'default'});

            this.setState(nextState, callback);
        }

        EventEmitter.emit('scroll-to-bottom');
    };

    getStatusFromSlashCommand = (message) => {
        const tokens = message.split(' ');

        if (tokens.length > 0) {
            return tokens[0].substring(1);
        }
        return '';
    };

    handleInputQuickAction = (inputValue) => {
        if (this.input.current) {
            this.input.current.setValue(inputValue, true);
            this.input.current.focus();
        }
    };

    handleLayout = (e) => {
        this.setState({
            top: e.nativeEvent.layout.y,
        });
    };

    handlePasteFiles = (error, files) => {
        if (this.props.screenId === EphemeralStore.getNavigationTopComponentId()) {
            if (error) {
                this.showPasteFilesErrorDialog();
                return;
            }

            const {maxFileSize} = this.props;
            const availableCount = MAX_FILE_COUNT - this.props.files.length;
            if (files.length > availableCount) {
                this.onShowFileMaxWarning();
                return;
            }

            const largeFile = files.find((image) => image.fileSize > maxFileSize);
            if (largeFile) {
                this.onShowFileSizeWarning(largeFile.fileName);
                return;
            }

            this.handleUploadFiles(files);
        }
    };

    handleSendMessage = () => {
        if (!this.input.current) {
            return;
        }

        this.input.current.resetTextInput();

        requestAnimationFrame(() => {
            const value = this.input.current.getValue();
            if (!this.isSendButtonEnabled()) {
                this.input.current.setValue(value);
                return;
            }

            this.setState({sendingMessage: true});

            const {channelId, files, handleClearFailedFiles, rootId} = this.props;

            const isReactionMatch = value.match(IS_REACTION_REGEX);
            if (isReactionMatch) {
                const emoji = isReactionMatch[2];
                this.sendReaction(emoji);
                return;
            }

            const hasFailedAttachments = files.some((f) => f.failed);
            if (hasFailedAttachments) {
                const {intl} = this.context;

                Alert.alert(
                    intl.formatMessage({
                        id: 'mobile.post_textbox.uploadFailedTitle',
                        defaultMessage: 'Attachment failure',
                    }),
                    intl.formatMessage({
                        id: 'mobile.post_textbox.uploadFailedDesc',
                        defaultMessage: 'Some attachments failed to upload to the server. Are you sure you want to post the message?',
                    }),
                    [{
                        text: intl.formatMessage({id: 'mobile.channel_info.alertNo', defaultMessage: 'No'}),
                        onPress: () => {
                            this.input.current.setValue(value);
                            this.setState({sendingMessage: false});
                        },
                    }, {
                        text: intl.formatMessage({id: 'mobile.channel_info.alertYes', defaultMessage: 'Yes'}),
                        onPress: () => {
                            // Remove only failed files
                            handleClearFailedFiles(channelId, rootId);
                            this.sendMessage();
                        },
                    }],
                );
            } else {
                this.sendMessage();
            }
        });
    };

    handleUploadFiles = async (files) => {
        const file = files[0];
        if (!file.fileSize | !file.fileName) {
            const path = (file.path || file.uri).replace('file://', '');
            const fileInfo = await RNFetchBlob.fs.stat(path);
            file.fileSize = fileInfo.size;
            file.fileName = fileInfo.filename;
        }

        if (file.fileSize > this.props.maxFileSize) {
            this.onShowFileSizeWarning(file.fileName);
        } else {
            this.props.initUploadFiles(files, this.props.rootId);
        }
    };

    isFileLoading = () => {
        const {files} = this.props;

        return files.some((file) => file.loading);
    };

    isSendButtonEnabled = () => {
        return this.canSend() && !this.isFileLoading() && !this.state.sendingMessage;
    };

    isStatusSlashCommand = (command) => {
        return command === General.ONLINE || command === General.AWAY ||
            command === General.DND || command === General.OFFLINE;
    };

    onShowFileMaxWarning = () => {
        EventEmitter.emit('fileMaxWarning');
    };

    onShowFileSizeWarning = (filename) => {
        const {formatMessage} = this.context.intl;
        const fileSizeWarning = formatMessage({
            id: 'file_upload.fileAbove',
            defaultMessage: 'File above {max} cannot be uploaded: {filename}',
        }, {
            max: getFormattedFileSize({size: this.props.maxFileSize}),
            filename,
        });

        EventEmitter.emit('fileSizeWarning', fileSizeWarning);
        setTimeout(() => {
            EventEmitter.emit('fileSizeWarning', null);
        }, 5000);
    };

    numberOfTimezones = async () => {
        const {channelId, getChannelTimezones} = this.props;
        const {data} = await getChannelTimezones(channelId);
        return data?.length || 0;
    };

    sendCommand = async (msg) => {
        const {intl} = this.context;
        const {channelId, executeCommand, rootId, userIsOutOfOffice} = this.props;

        const status = this.getStatusFromSlashCommand(msg);
        if (userIsOutOfOffice && this.isStatusSlashCommand(status)) {
            confirmOutOfOfficeDisabled(intl, status, this.updateStatus);
            this.setState({sendingMessage: false});
            return;
        }

        const {error} = await executeCommand(msg, channelId, rootId);
        this.setState({sendingMessage: false});

        if (error) {
            this.input.current.setValue(msg);
            Alert.alert(
                intl.formatMessage({
                    id: 'mobile.commands.error_title',
                    defaultMessage: 'Error Executing Command',
                }),
                error.message,
            );
            return;
        }

        this.input.current.setValue('');
        this.input.current.changeDraft('');
    };

    mapGroupMentions = (groupMentions) => {
        const {channelMemberCountsByGroup} = this.props;
        let memberNotifyCount = 0;
        let channelTimezoneCount = 0;
        const groupMentionsSet = new Set();
        groupMentions.
            forEach((group) => {
                const mappedValue = channelMemberCountsByGroup[group.id];
                if (mappedValue?.channel_member_count > NOTIFY_ALL_MEMBERS && mappedValue?.channel_member_count > memberNotifyCount) {
                    memberNotifyCount = mappedValue.channel_member_count;
                    channelTimezoneCount = mappedValue.channel_member_timezones_count;
                }
                groupMentionsSet.add(`@${group.name}`);
            });
        return {groupMentionsSet, memberNotifyCount, channelTimezoneCount};
    }

    sendMessage = () => {
        const value = this.input.current.getValue();

        if (value) {
            const {enableConfirmNotificationsToChannel, membersCount, useGroupMentions, useChannelMentions} = this.props;
            const notificationsToChannel = enableConfirmNotificationsToChannel && useChannelMentions;
            const notificationsToGroups = enableConfirmNotificationsToChannel && useGroupMentions;
            const toAllOrChannel = this.textContainsAtAllAtChannel(value);
            const groupMentions = (!toAllOrChannel && notificationsToGroups) ? this.groupsMentionedInText(value) : [];

            if (value.indexOf('/') === 0) {
                this.sendCommand(value);
            } else if (notificationsToChannel && membersCount > NOTIFY_ALL_MEMBERS && toAllOrChannel) {
                this.showSendToAllOrChannelAlert(membersCount, value);
            } else if (groupMentions.length > 0) {
                const {groupMentionsSet, memberNotifyCount, channelTimezoneCount} = this.mapGroupMentions(groupMentions);
                if (memberNotifyCount > 0) {
                    this.showSendToGroupsAlert(Array.from(groupMentionsSet), memberNotifyCount, channelTimezoneCount, value);
                } else {
                    this.doSubmitMessage();
                }
            } else {
                this.doSubmitMessage();
            }
        }
    };

    sendReaction = (emoji) => {
        const {addReactionToLatestPost, rootId} = this.props;
        addReactionToLatestPost(emoji, rootId);

        this.input.current.setValue('');
        this.input.current.changeDraft('');

        this.setState({sendingMessage: false});
    };

    showPasteFilesErrorDialog = () => {
        const {formatMessage} = this.context.intl;
        Alert.alert(
            formatMessage({
                id: 'mobile.files_paste.error_title',
                defaultMessage: 'Paste failed',
            }),
            formatMessage({
                id: 'mobile.files_paste.error_description',
                defaultMessage: 'An error occurred while pasting the file(s). Please try again.',
            }),
            [
                {
                    text: formatMessage({
                        id: 'mobile.files_paste.error_dismiss',
                        defaultMessage: 'Dismiss',
                    }),
                },
            ],
        );
    };

    showSendToAllOrChannelAlert = (membersCount, msg) => {
        const {intl} = this.context;
        const {channelTimezoneCount} = this.state;
        const {isTimezoneEnabled} = this.props;

        let notifyAllMessage = '';
        if (isTimezoneEnabled && channelTimezoneCount) {
            notifyAllMessage = (
                intl.formatMessage(
                    {
                        id: 'mobile.post_textbox.entire_channel.message.with_timezones',
                        defaultMessage: 'By using @all or @channel you are about to send notifications to {totalMembers, number} {totalMembers, plural, one {person} other {people}} in {timezones, number} {timezones, plural, one {timezone} other {timezones}}. Are you sure you want to do this?',
                    },
                    {
                        totalMembers: membersCount - 1,
                        timezones: channelTimezoneCount,
                    },
                )
            );
        } else {
            notifyAllMessage = (
                intl.formatMessage(
                    {
                        id: 'mobile.post_textbox.entire_channel.message',
                        defaultMessage: 'By using @all or @channel you are about to send notifications to {totalMembers, number} {totalMembers, plural, one {person} other {people}}. Are you sure you want to do this?',
                    },
                    {
                        totalMembers: membersCount - 1,
                    },
                )
            );
        }

        Alert.alert(
            intl.formatMessage({
                id: 'mobile.post_textbox.entire_channel.title',
                defaultMessage: 'Confirm sending notifications to entire channel',
            }),
            notifyAllMessage,
            [
                {
                    text: intl.formatMessage({
                        id: 'mobile.post_textbox.entire_channel.cancel',
                        defaultMessage: 'Cancel',
                    }),
                    onPress: () => {
                        this.input.current.setValue(msg);
                        this.setState({sendingMessage: false});
                    },
                },
                {
                    text: intl.formatMessage({
                        id: 'mobile.post_textbox.entire_channel.confirm',
                        defaultMessage: 'Confirm',
                    }),
                    onPress: () => this.doSubmitMessage(),
                },
            ],
        );
    };

    textContainsAtAllAtChannel = (text) => {
        const textWithoutCode = text.replace(CODE_REGEX, '');
        return (/(?:\B|\b_+)@(channel|all)(?!(\.|-|_)*[^\W_])/i).test(textWithoutCode);
    };

    groupsMentionedInText = (text) => {
        const {groupsWithAllowReference} = this.props;
        const groups = [];
        if (groupsWithAllowReference.size > 0) {
            const textWithoutCode = text.replace(CODE_REGEX, '');
            const mentions = textWithoutCode.match(AT_MENTION_REGEX_GLOBAL) || [];
            mentions.forEach((mention) => {
                const group = groupsWithAllowReference.get(mention);
                if (group) {
                    groups.push(group);
                }
            });
        }
        return groups;
    }

    updateInitialValue = (value) => {
        this.setState({value});
    }

    updateStatus = (status) => {
        const {currentUserId, setStatus} = this.props;
        setStatus({
            user_id: currentUserId,
            status,
        });
    };

    render = () => {
        const {channelIsArchived, deactivatedChannel, rootId, theme} = this.props;
        if (channelIsArchived || deactivatedChannel) {
            return (
                <Archived
                    defactivated={deactivatedChannel}
                    rootId={rootId}
                    theme={theme}
                />
            );
        }

        const {
            canPost,
            channelDisplayName,
            channelId,
            channelIsReadOnly,
            cursorPositionEvent,
            isLandscape,
            files,
            maxFileSize,
            maxMessageLength,
            screenId,
            valueEvent,
            registerTypingAnimation,
        } = this.props;
        const style = getStyleSheet(theme);
        const readonly = channelIsReadOnly || !canPost;

        return (
            <>
                <Typing
                    theme={theme}
                    registerTypingAnimation={registerTypingAnimation}
                />
                {Platform.OS === 'android' &&
                <Autocomplete
                    cursorPositionEvent={cursorPositionEvent}
                    maxHeight={Math.min(this.state.top - AUTOCOMPLETE_MARGIN, AUTOCOMPLETE_MAX_HEIGHT)}
                    onChangeText={this.handleInputQuickAction}
                    valueEvent={valueEvent}
                />
                }
                <View
                    style={[style.inputWrapper, padding(isLandscape)]}
                    onLayout={this.handleLayout}
                >
                    <ScrollView
                        style={[style.inputContainer, readonly ? style.readonlyContainer : null]}
                        contentContainerStyle={style.inputContentContainer}
                        keyboardShouldPersistTaps={'always'}
                        scrollEnabled={false}
                        showsVerticalScrollIndicator={false}
                        showsHorizontalScrollIndicator={false}
                        pinchGestureEnabled={false}
                        overScrollMode={'never'}
                        disableScrollViewPanResponder={true}
                    >
                        <PostInput
                            channelDisplayName={channelDisplayName}
                            channelId={channelId}
                            cursorPositionEvent={cursorPositionEvent}
                            inputEventType={valueEvent}
                            isLandscape={isLandscape}
                            maxMessageLength={maxMessageLength}
                            onPasteFiles={this.handlePasteFiles}
                            onSend={this.handleSendMessage}
                            readonly={readonly}
                            ref={this.input}
                            rootId={rootId}
                            screenId={screenId}
                            theme={theme}
                            updateInitialValue={this.updateInitialValue}
                        />
                        <Uploads
                            files={files}
                            rootId={rootId}
                            theme={theme}
                        />
                        <QuickActions
                            blurTextBox={this.blurTextBox}
                            canSend={this.isSendButtonEnabled()}
                            fileCount={files.length}
                            initialValue={this.state.value}
                            inputEventType={valueEvent}
                            maxFileSize={maxFileSize}
                            onSend={this.handleSendMessage}
                            onShowFileMaxWarning={this.onShowFileMaxWarning}
                            onTextChange={this.handleInputQuickAction}
                            onUploadFiles={this.handleUploadFiles}
                            readonly={readonly}
                            theme={theme}
                        />
                    </ScrollView>
                </View>
            </>
        );
    };
}

const getStyleSheet = makeStyleSheetFromTheme((theme) => {
    return {
        inputContainer: {
            flex: 1,
            flexDirection: 'column',
        },
        inputContentContainer: {
            alignItems: 'stretch',
            paddingTop: Platform.select({
                ios: 7,
                android: 0,
            }),
        },
        inputWrapper: {
            alignItems: 'flex-end',
            flexDirection: 'row',
            justifyContent: 'center',
            paddingBottom: 2,
            backgroundColor: theme.centerChannelBg,
            borderTopWidth: 1,
            borderTopColor: changeOpacity(theme.centerChannelColor, 0.20),
        },
        readonlyContainer: {
            marginLeft: 10,
        },
    };
});
